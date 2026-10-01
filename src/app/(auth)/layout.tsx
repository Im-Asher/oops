import { AuthBrandPanel } from "@/components/auth/brand-panel";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    // 深色门厅：与 /chat 同色系（dark + #0A0A0A），md 以下收窄为顶部紧凑条
    <div className="dark flex min-h-screen flex-col bg-[#0A0A0A] md:h-screen md:flex-row">
      <AuthBrandPanel />
      <div className="flex flex-1 justify-center px-4 py-10 md:py-0">
        {/* my-auto 而非 items-center：矮视口下溢出可滚动，不被裁切 */}
        <div className="my-auto w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
