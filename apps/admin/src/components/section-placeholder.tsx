import { Empty } from "antd";

/**
 * 六面通用空态占位（task 3.1）：M2 各面替换为真实功能页时逐个退役。
 * RSC 可直接用（antd Empty 单层使用，不触碰复合组件静态属性）。
 */
export default function SectionPlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div style={{ padding: "48px 0" }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>{title}</h2>
      <Empty description={description} />
    </div>
  );
}
