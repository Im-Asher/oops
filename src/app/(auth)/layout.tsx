export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">oops</h1>
        <p className="mt-2 text-sm text-muted-foreground">AI 电商图像工作台</p>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
