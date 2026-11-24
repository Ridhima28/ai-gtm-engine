import type { ReactNode } from "react";

export const demoPageClass = "mx-auto max-w-[1390px] space-y-6 px-4 pb-12 pt-6 sm:px-8 sm:pt-8 lg:px-10";

export function DemoPageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#dbe5f1] pb-5">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-[#172b49] sm:text-3xl">{title}</h1>
        <p className="max-w-[60ch] text-sm leading-6 text-[#536780]">{description}</p>
      </div>
      {action && <div className="flex max-w-full flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}
