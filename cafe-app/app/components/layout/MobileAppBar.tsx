import { useT } from "@agent-native/core/client/i18n";
import { IconMenu2 } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface MobileAppBarProps {
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function MobileAppBar({ title, actions, className }: MobileAppBarProps) {
  const t = useT();

  return (
    <header
      data-mobile-app-bar=""
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2",
        className,
      )}
    >
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="chat-navigation-toggle md:hidden"
          aria-label={t("navigation.openNavigation")}
        >
          <IconMenu2 className="size-4" />
        </Button>
      </SheetTrigger>
      <div className="flex min-w-0 flex-1 items-center truncate text-sm font-medium">
        {title}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </header>
  );
}
