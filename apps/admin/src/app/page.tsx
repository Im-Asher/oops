"use client";

// M0.3 task 1.2 spike: antd v6 + React 19 SSR 渲染验证（Table/Form/Result）。
// 必须标 "use client"：RSC 的 client-reference proxy 不透传复合组件静态属性
// （Form.Item 等）——antd 复合组件一律在 client 组件中使用（task 3.1 布局同理）。
import { Button, Form, Input, Result, Table } from "antd";

const columns = [
  { title: "ID", dataIndex: "id" },
  { title: "Name", dataIndex: "name" },
  { title: "Status", dataIndex: "status" },
];

const data = [
  { key: "1", id: "u_01", name: "Alice", status: "active" },
  { key: "2", id: "u_02", name: "Bob", status: "inactive" },
];

export default function AdminHome() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Oops Admin</h1>
      <Table columns={columns} dataSource={data} pagination={false} size="small" />
      <Form layout="inline" style={{ marginTop: 24 }}>
        <Form.Item label="Keyword" name="keyword">
          <Input placeholder="search" />
        </Form.Item>
        <Form.Item>
          <Button type="primary">Search</Button>
        </Form.Item>
      </Form>
      <Result style={{ marginTop: 24 }} status="403" title="403" subTitle="Forbidden preview" />
    </main>
  );
}
