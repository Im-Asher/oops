import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/messages";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.metadata");
  return {
    title: t("title"),
    description: t("description"),
  };
}

// html lang 映射：新增 Locale 时此表缺项会在编译期报错（spec「按 locale 渲染」）
const htmlLang: Record<Locale, string> = {
  zh: "zh-CN",
  en: "en",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const lang = htmlLang[locale];

  return (
    <html
      lang={lang}
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <head>
        {/* 首屏阻塞防闪烁：默认暗色（html 已带 dark），仅存储为 light 时移除 */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("oops-theme")==="light")document.documentElement.classList.remove("dark")}catch(e){}',
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        {/* 无 props：自动继承 request.ts 的请求配置供客户端组件使用 */}
        <NextIntlClientProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
