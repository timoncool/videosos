"use client";

import { useTranslations } from "next-intl";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

type KeyDialogProps = {} & Parameters<typeof Dialog>[0];

export function KeyDialog({ onOpenChange, open, ...props }: KeyDialogProps) {
  const t = useTranslations("app.keyDialog");
  const [falKey, setFalKey] = useState("");

  useEffect(() => {
    if (open) {
      const savedKey = localStorage.getItem("falKey") || "";
      setFalKey(savedKey);
    }
  }, [open]);

  const handleOnOpenChange = (isOpen: boolean) => {
    onOpenChange?.(isOpen);
  };

  const handleSave = () => {
    localStorage.setItem("falKey", falKey);
    handleOnOpenChange(false);
    setFalKey("");
  };

  return (
    <Dialog {...props} onOpenChange={handleOnOpenChange} open={open}>
      <DialogContent className="flex flex-col max-w-lg h-fit">
        <DialogHeader>
          <DialogTitle className="sr-only">{t("title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col flex-1 gap-8">
          <h2 className="text-lg font-semibold flex flex-row gap-2">
            {t("saveKey")}
          </h2>
          <div className="flex flex-col gap-4">
            <Input
              placeholder={t("placeholder")}
              value={falKey}
              onChange={(e) => setFalKey(e.target.value)}
            />
            <p className="text-muted-foreground text-sm">
              {t("privacyNotice")}
            </p>
          </div>
          <div className="flex-1 flex flex-row items-end justify-center gap-2">
            <Button onClick={handleSave}>{t("save")}</Button>
          </div>
        </div>

        <DialogFooter>
          <p className="text-muted-foreground text-sm mt-4 w-full text-center">
            {t.rich("footerText", {
              link: (chunks) => (
                <a
                  className="underline underline-offset-2 decoration-foreground/50 text-foreground"
                  href="https://fal.ai/dashboard/keys"
                >
                  {chunks}
                </a>
              ),
            })}
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
