import { describe, expect, it } from 'vitest'
import { cleanReleaseNotes, formatBytes, formatSpeed } from './updateFormat'

describe('formatBytes 字节格式化（1024 进制）', () => {
  it('0 与小于 1KB 取整显示 B', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })

  it('KB 起保留 1 位小数', () => {
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(8_600_000)).toBe('8.2 MB')
  })

  it('数值 ≥100 显示为整数', () => {
    expect(formatBytes(136 * 1024 * 1024)).toBe('136 MB')
  })

  it('GB 级', () => {
    expect(formatBytes(1.5e9)).toBe('1.4 GB')
  })
})

describe('formatSpeed 速度格式化', () => {
  it('0 与 B 级', () => {
    expect(formatSpeed(0)).toBe('0 B/s')
    expect(formatSpeed(512)).toBe('512 B/s')
  })

  it('MB 级', () => {
    expect(formatSpeed(3.2 * 1024 * 1024)).toBe('3.2 MB/s')
  })
})

describe('cleanReleaseNotes 更新说明清洗', () => {
  it('去掉行首标题标记', () => {
    expect(cleanReleaseNotes("## What's Changed")).toBe("What's Changed")
  })

  it('去掉加粗与斜体标记', () => {
    expect(cleanReleaseNotes('**Full Changelog**')).toBe('Full Changelog')
    expect(cleanReleaseNotes('*斜体*')).toBe('斜体')
  })

  it('链接转纯文字', () => {
    expect(cleanReleaseNotes('详见 [v1.1.0](https://github.com/hi-done/ireader/releases/tag/v1.1.0)')).toBe('详见 v1.1.0')
  })

  it('GitHub PR / Issue 长链接缩为 #N', () => {
    expect(cleanReleaseNotes('feat: xxx by @hi-done in https://github.com/hi-done/ireader/pull/12')).toBe(
      'feat: xxx by @hi-done in #12'
    )
  })

  it('图片语法整段移除', () => {
    expect(cleanReleaseNotes('![icon](https://x.com/i.png) 文案')).toBe('文案')
  })

  it('连续空行折叠为一个空行', () => {
    expect(cleanReleaseNotes('a\n\n\n\nb')).toBe('a\n\nb')
  })

  it('空串安全', () => {
    expect(cleanReleaseNotes('')).toBe('')
  })

  it('连续完全相同的段落折叠为一', () => {
    expect(cleanReleaseNotes('A\n\nA\n\nB')).toBe('A\n\nB')
  })
})

describe('cleanReleaseNotes HTML 清洗（releases.atom 实态）', () => {
  it('HTML 段落剥标签保留文字（实际发布形态）', () => {
    const html =
      '<p><strong>Full Changelog</strong>: <a class="commit-link" href="https://github.com/hi-done/ireader/compare/v1.2.0...v1.2.1"><tt>v1.2.0...v1.2.1</tt></a></p>'
    expect(cleanReleaseNotes(html)).toBe('Full Changelog: v1.2.0...v1.2.1')
  })

  it('块级标签转换行，段落各自成行', () => {
    expect(cleanReleaseNotes('<p>第一段</p><p>第二段</p>')).toBe('第一段\n第二段')
    expect(cleanReleaseNotes('<p>第一段</p>\n<p>第二段</p>')).toBe('第一段\n\n第二段')
  })

  it('列表项各自成行', () => {
    expect(cleanReleaseNotes('<ul><li>甲</li><li>乙</li></ul>')).toBe('甲\n乙')
  })

  it('HTML 图片整体移除', () => {
    expect(cleanReleaseNotes('<p>看图 <img src="https://x.com/i.png" alt="image"></p>')).toBe('看图')
  })

  it('常见实体解码，&amp; 不二次解码', () => {
    expect(cleanReleaseNotes('<p>A &amp; B &lt;tag&gt; &quot;q&quot;</p>')).toBe('A & B <tag> "q"')
  })

  it('整段重复两遍折叠为一（v1.2.1 实测场景）', () => {
    const html =
      '<p><strong>Full Changelog</strong>: <a class="commit-link" href="https://github.com/hi-done/ireader/compare/v1.2.0...v1.2.1"><tt>v1.2.0...v1.2.1</tt></a></p>\n' +
      '<p><strong>Full Changelog</strong>: <a class="commit-link" href="https://github.com/hi-done/ireader/compare/v1.2.0...v1.2.1"><tt>v1.2.0...v1.2.1</tt></a></p>'
    expect(cleanReleaseNotes(html)).toBe('Full Changelog: v1.2.0...v1.2.1')
  })
})
