/**
 * 共享媒体唯一编辑点。
 *
 * 同一个 /media/qiguang-hero-wide.jpg 被三个页面的不同容器消费：
 * 首页 Hero（16:9 · cover center）、节目页展墙（4:3 · cover 50% 20%）、
 * 购票卡片（约 3:4 · cover top）。横版→竖版替换意图只改这一行 src
 * （build-variants.mjs 将 wide 换成 tall 生成 dist-tall），
 * 三个容器的裁切几何差异由四视口证据链捕获。
 */
export default function SharedFestivalImage({ className }: { className?: string }) {
  return (
    <img
      data-consumer="shared-hero"
      alt="栖光艺术节主视觉"
      src="/media/qiguang-hero-wide.jpg"
      className={className}
    />
  )
}
