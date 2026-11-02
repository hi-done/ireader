# -*- coding: utf-8 -*-
"""yymanhua 章节漫画 → 单文件 PDF。

用法：
    python manga2pdf.py --url http://www.yymanhua.com/m374992/ --out "D:\\books\\咒術回戰 第271話.pdf"

流程：
1) 抓第 1 页 HTML，读取 YYMANHUA_IMAGE_COUNT（总页数）、CID、MID、标题
2) 逐页抓 HTML，取该页独有的 _dt / _sign 签名，请求 chapterimage.ashx
3) 接口返回 packer 混淆代码，用 jsunpack 离线解包，拼出图片绝对地址
4) 每页只取首图（第二张是站点的下一页预加载，会重复），带 Referer 下载后缓存
5) 按页序合成 PDF，页面尺寸等比换算，不裁切不缩放
6) 生成成功后删除下载的图片（含缓存目录），只留 PDF；有缺页时保留图片便于重跑补齐
7) 退出前清理脚本目录下的 __pycache__（import jsunpack 产生的 .pyc），不留在仓库里

退出码：0 全部成功；2 参数/页面结构错误；3 有缺页但仍生成了 PDF。
"""
import argparse
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import jsunpack  # noqa: E402

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif")
BAD_NAME_CHARS = re.compile(r'[\\/:*?"<>|\r\n\t]')


def log(msg):
    print(msg, flush=True)


def fetch(url, referer, binary=False, retries=3):
    """带浏览器头抓取；站点校验 UA 与 Referer，缺失会返回 403"""
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={
            "User-Agent": UA,
            "Referer": referer,
            "Accept": "*/*",
            "Accept-Language": "zh-CN,zh;q=0.9",
        })
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            return data if binary else data.decode("utf-8", "ignore")
        except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("抓取失败 %s: %s" % (url, last))


def parse_var(html, name):
    m = re.search(r"var\s+%s\s*=\s*([^;]+);" % name, html)
    if not m:
        raise RuntimeError("页面结构变化：缺少变量 %s" % name)
    return m.group(1).strip().strip('"').strip("'")


def page_url(chapter_url, index):
    """第 1 页是 <章节>/，第 N 页是 <章节>-pN/"""
    base = chapter_url.rstrip("/")
    return base + "/" if index == 1 else "%s-p%d/" % (base, index)


def resolve_image_urls(body, referer):
    """解析 chapterimage.ashx 返回体：解包后取 pix + pvalue 拼绝对地址"""
    code = jsunpack.unpack(body) or body
    m = re.search(r'var\s+pix\s*=\s*"([^"]+)"', code)
    if m:
        pix = m.group(1)
        tail = re.search(r"var\s+pvalue\s*=\s*\[(.*?)\]", code, re.S)
        urls = []
        for part in (re.findall(r'"([^"]*)"', tail.group(1)) if tail else []):
            u = pix + part
            urls.append(u if u.startswith("http") else urllib.parse.urljoin(referer, u))
        return urls
    return re.findall(r'"(https?://[^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*)"', code, re.I)


def cache_path(workdir, page):
    """缓存文件名固定为 pNNN.<ext>，已存在则复用，支持断点续跑"""
    for ext in IMG_EXT:
        fp = os.path.join(workdir, "p%03d%s" % (page, ext))
        if os.path.exists(fp) and os.path.getsize(fp) > 1024:
            return fp
    return None


def download_chapter(chapter_url, workdir, max_pages=None):
    """下载整章，返回 {title,total,pages,missing}；pages 按页序排列"""
    os.makedirs(workdir, exist_ok=True)
    first = fetch(page_url(chapter_url, 1), chapter_url)
    total = int(parse_var(first, "YYMANHUA_IMAGE_COUNT"))
    title = parse_var(first, "YYMANHUA_CTITLE")
    cid = parse_var(first, "YYMANHUA_CID")
    mid = parse_var(first, "YYMANHUA_MID")
    if max_pages:
        total = min(total, max_pages)
    log("标题=%s 页数=%d cid=%s mid=%s" % (title, total, cid, mid))

    pages, missing = [], []
    for page in range(1, total + 1):
        purl = page_url(chapter_url, page)
        cached = cache_path(workdir, page)
        if cached:
            pages.append(cached)
            log("[%02d] 复用缓存 %s" % (page, os.path.basename(cached)))
            continue
        try:
            html = first if page == 1 else fetch(purl, chapter_url)
            # 签名每页不同，必须用该页 HTML 里的值
            dt = parse_var(html, "YYMANHUA_VIEWSIGN_DT")
            sign = parse_var(html, "YYMANHUA_VIEWSIGN")
            api = ("%schapterimage.ashx?cid=%s&page=%d&key=&_cid=%s&_mid=%s&_dt=%s&_sign=%s"
                   % (purl, cid, page, cid, mid, urllib.parse.quote(dt), sign))
            urls = resolve_image_urls(fetch(api, purl), purl)
            if not urls:
                raise RuntimeError("接口未返回图片地址")
            iurl = urls[0]  # 第 2 张是下一页预加载，取首图
            ext = os.path.splitext(iurl.split("?")[0])[1].lower()
            if ext not in IMG_EXT:
                ext = ".jpg"
            fp = os.path.join(workdir, "p%03d%s" % (page, ext))
            with open(fp, "wb") as f:
                f.write(fetch(iurl, purl, binary=True))
            pages.append(fp)
            log("[%02d] %s (%d bytes)" % (page, iurl, os.path.getsize(fp)))
        except Exception as e:  # noqa: BLE001 单页失败不中断整章
            missing.append(page)
            log("[%02d] 失败：%s" % (page, e))

    return {"title": title, "total": total, "pages": pages, "missing": missing}


def resolve_out_path(out, title):
    """--out 传目录则按标题命名文件，传 .pdf 则直接使用"""
    name = BAD_NAME_CHARS.sub("_", title).strip() or "manga"
    if out.lower().endswith(".pdf"):
        path = out
    else:
        path = os.path.join(out, name + ".pdf")
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    return path


def build_pdf(images, out_path, dpi, title):
    """按图片原始像素等比换算页面尺寸，避免裁切与变形"""
    from PIL import Image

    pages = []
    for fp in images:
        with Image.open(fp) as im:
            im.load()
            pages.append(im.convert("RGB"))
    pages[0].save(out_path, "PDF", save_all=True, append_images=pages[1:],
                  resolution=dpi, title=title, author="yymanhua")
    return len(pages)


def cleanup_images(images, workdir):
    """删除本次用到的 pNNN.<ext> 图片；目录因此变空时一并移除。

    只删 images 里列出的文件（都是脚本自己下载或复用的缓存图），不碰目录里
    的其他文件；PDF 不受影响（build_pdf 时图片已写入 PDF）。
    """
    removed = 0
    for fp in images:
        if os.path.isfile(fp) and os.path.dirname(os.path.abspath(fp)) == os.path.abspath(workdir):
            os.remove(fp)
            removed += 1
    if os.path.isdir(workdir) and not os.listdir(workdir):
        os.rmdir(workdir)
    return removed


def cleanup_pycache():
    """删除脚本目录下的 __pycache__（import jsunpack 时 Python 自动生成的字节码缓存）

    .pyc 对下载速度没有实际帮助，留在 skill 目录里反而可能被误提交进仓库，
    因此每次运行结束都清掉；删不掉（被占用等）时只跳过，不影响主流程。
    """
    cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), "__pycache__")
    if not os.path.isdir(cache):
        return 0
    removed = 0
    for name in os.listdir(cache):
        if name.endswith(".pyc"):
            try:
                os.remove(os.path.join(cache, name))
                removed += 1
            except OSError:
                pass
    try:
        if not os.listdir(cache):
            os.rmdir(cache)
    except OSError:
        pass
    return removed


def main():
    ap = argparse.ArgumentParser(description="yymanhua 章节漫画转单文件 PDF")
    ap.add_argument("--url", required=True, help="章节阅读页 URL，如 http://www.yymanhua.com/m374992/")
    ap.add_argument("--out", required=True, help="PDF 保存路径（.pdf 文件或目标目录）")
    ap.add_argument("--workdir", default=None, help="图片缓存目录，默认系统临时目录下 manga_<cid>")
    ap.add_argument("--dpi", type=float, default=150.0, help="PDF 分辨率，默认 150（1080px 宽≈A4）")
    ap.add_argument("--max-pages", type=int, default=None, help="只处理前 N 页，用于快速验证")
    ap.add_argument("--keep-images", action="store_true",
                    help="保留下载的图片（默认生成 PDF 后删除，仅在有缺页时自动保留）")
    args = ap.parse_args()

    if not re.search(r"/m\d+/?", args.url):
        log("URL 不是章节阅读页（应形如 http://www.yymanhua.com/m374992/）；"
            "作品目录页含多话，请指定具体一话的 URL")
        return 2

    m = re.search(r"/m(\d+)/?", args.url)
    workdir = args.workdir or os.path.join(tempfile.gettempdir(), "manga_" + m.group(1))

    result = download_chapter(args.url, workdir, args.max_pages)
    if not result["pages"]:
        log("没有下载到任何图片，未生成 PDF")
        return 2

    out_path = resolve_out_path(args.out, result["title"])
    count = build_pdf(result["pages"], out_path, args.dpi, result["title"])
    size_mb = os.path.getsize(out_path) / 1024.0 / 1024.0
    log("PDF=%s" % out_path)
    log("页数=%d 大小=%.2fMB" % (count, size_mb))

    if result["missing"]:
        # 缺页时保留图片，便于重跑同一命令只补缺的那几页
        log("缺页: %s" % ",".join(str(p) for p in result["missing"]))
        log("图片暂留在 %s，重跑同一命令会复用并补齐" % os.path.abspath(workdir))
        return 3
    if args.keep_images:
        log("图片已保留（--keep-images）: %s" % os.path.abspath(workdir))
    else:
        removed = cleanup_images(result["pages"], workdir)
        log("已清理下载的图片: %d 个（%s）" % (removed, os.path.abspath(workdir)))
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    code = 0
    try:
        code = main()
    finally:
        # 成功、缺页、报错都清理，避免 .pyc 残留在 skill 目录
        if cleanup_pycache():
            log("已清理 Python 字节码缓存: __pycache__")
    sys.exit(code)
