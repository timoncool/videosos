"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Logo } from "./logo";
import { SettingsIcon } from "lucide-react";
import { LanguageSwitcher } from "./language-switcher";

export default function Header({
  openKeyDialog,
}: {
  openKeyDialog?: () => void;
}) {
  const t = useTranslations("app.header");

  return (
    <header className="px-4 py-2 flex justify-between items-center border-b border-border">
      <h1 className="text-lg font-medium">
        <Logo />
      </h1>
      <nav className="flex flex-row items-center justify-end gap-1">
        <Button variant="ghost" size="sm" asChild>
          <a
            href="https://github.com/timoncool/videosos"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("github")}
          </a>
        </Button>
        <LanguageSwitcher />
        {openKeyDialog && (
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            onClick={openKeyDialog}
          >
            {typeof localStorage !== "undefined" &&
              !localStorage?.getItem("falKey") && (
                <span className="dark:bg-orange-400 bg-orange-600 w-2 h-2 rounded-full absolute top-1 right-1"></span>
              )}
            <SettingsIcon className="w-6 h-6" />
          </Button>
        )}
      </nav>
    </header>
  );
}
