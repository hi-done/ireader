# -*- coding: utf-8 -*-
"""Dean Edwards p,a,c,k,e,d 解包器（离线静态还原，不执行远端脚本）。

yymanhua 阅读接口 chapterimage.ashx 返回形如：
    eval(function(p,a,c,k,e,d){...}('payload',a,c,'w0|w1|...'.split('|'),0,{}))
解包后可读回原始 JS，从中取出 pix 基址、pvalue 文件名列表与 key。
"""
import re

CALL_RE = re.compile(
    r"eval\(function\(p,a,c,k,e,d\)\{.*?\}\((['\"])(?P<payload>.*?)\1\s*,"
    r"\s*(?P<base>\d+)\s*,\s*(?P<count>\d+)\s*,\s*(['\"])(?P<words>.*?)\5\.split\('\|'\)",
    re.S,
)

ESC_RE = re.compile(r"\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)")


def unescape_js(s):
    """还原 JS 字符串字面量里的转义序列"""
    def repl(m):
        t = m.group(1)
        if t[0] in ("x", "u"):
            return chr(int(t[1:], 16))
        return {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f"}.get(t, t)

    return ESC_RE.sub(repl, s)


def digit_value(ch):
    """e() 的逆运算：字符还原为数值（0-9a-zA-Z）"""
    if "0" <= ch <= "9":
        return ord(ch) - 48
    if "a" <= ch <= "z":
        return ord(ch) - 87
    if "A" <= ch <= "Z":
        return ord(ch) - 29
    return -1


def token_value(token, base):
    val = 0
    for ch in token:
        d = digit_value(ch)
        if d < 0:
            return None
        val = val * base + d
    return val


def unpack(src):
    """解包成功返回原始 JS 文本，非 packer 内容返回 None"""
    m = CALL_RE.search(src)
    if not m:
        return None
    payload = unescape_js(m.group("payload"))
    base = int(m.group("base"))
    count = int(m.group("count"))
    words = unescape_js(m.group("words")).split("|")

    def repl(mo):
        tok = mo.group(0)
        idx = token_value(tok, base)
        if idx is not None and idx < count and words[idx]:
            return words[idx]
        return tok

    return re.sub(r"\b\w+\b", repl, payload)
