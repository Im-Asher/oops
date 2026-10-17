"use client";

// 管理端登录页（管理端自带登录入口，不依赖 web 端会话）：
// antd Form 客户端组件，提交后由服务端下发管理端会话 cookie 再进入管理布局。
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert, Button, Card, Form, Input, Typography } from "antd";

interface LoginFormValues {
  username: string;
  password: string;
}

export default function LoginPage() {
  const t = useTranslations("common.login");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onFinish(values: LoginFormValues): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        setError(data?.error?.message ?? t("failed"));
        return;
      }
      // 会话 cookie 已下发：替换登录页并刷新 RSC，使布局层门卫重新校验
      router.replace("/");
      router.refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Card style={{ width: 360 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          {t("title")}
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          {t("subtitle")}
        </Typography.Paragraph>
        {error !== null && (
          <Alert type="error" title={error} style={{ marginBottom: 16 }} />
        )}
        <Form<LoginFormValues> layout="vertical" onFinish={onFinish} disabled={submitting}>
          <Form.Item
            name="username"
            label={t("username")}
            rules={[{ required: true, message: t("required") }]}
          >
            <Input autoComplete="username" placeholder={t("usernamePlaceholder")} />
          </Form.Item>
          <Form.Item
            name="password"
            label={t("password")}
            rules={[{ required: true, message: t("required") }]}
          >
            <Input.Password
              autoComplete="current-password"
              placeholder={t("passwordPlaceholder")}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            {t("submit")}
          </Button>
        </Form>
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 16 }}>
          {tCommon("appTitle")}
        </Typography.Text>
      </Card>
    </main>
  );
}
