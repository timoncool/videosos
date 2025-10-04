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
  const [runwareKey, setRunwareKey] = useState("");

  useEffect(() => {
    if (open) {
      const savedFalKey = localStorage.getItem("falKey") || "";
      const savedRunwareKey = localStorage.getItem("runwareKey") || "";
      setFalKey(savedFalKey);
      setRunwareKey(savedRunwareKey);
    }
  }, [open]);

  const handleOnOpenChange = (isOpen: boolean) => {
    onOpenChange?.(isOpen);
  };

  const handleSave = () => {
    localStorage.setItem("falKey", falKey);
    localStorage.setItem("runwareKey", runwareKey);
    handleOnOpenChange(false);
    setFalKey("");
    setRunwareKey("");
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
            <div>
              <label className="text-sm font-medium text-muted-foreground">FAL API Key</label>
              <Input
                placeholder={t("placeholder")}
                value={falKey}
                onChange={(e) => setFalKey(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Runware API Key</label>
              <Input
                placeholder={t("runwarePlaceholder")}
                value={runwareKey}
                onChange={(e) => setRunwareKey(e.target.value)}
              />
            </div>
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
              falLink: (chunks) => (
                <a
                  className="underline underline-offset-2 decoration-foreground/50 text-foreground"
                  href="https://fal.ai/dashboard/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {chunks}
                </a>
              ),
              runwareLink: (chunks) => (
                <a
                  className="underline underline-offset-2 decoration-foreground/50 text-foreground"
                  href="https://runware.ai"
                  target="_blank"
                  rel="noopener noreferrer"
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
