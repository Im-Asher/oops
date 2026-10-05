import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "oops · AI 电商图像工作台",
  description: "描述需求，生成商品详情图、海报与场景图",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
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
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
