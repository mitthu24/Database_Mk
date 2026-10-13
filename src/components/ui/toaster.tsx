"use client";

import { Toaster as Sonner } from "sonner";

// Single toast provider for the whole app (success/error feedback on writes).
// Styling follows the app's own tokens rather than sonner's defaults.
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: "rounded-lg border bg-card text-card-foreground shadow-md",
          title: "text-sm font-medium",
          description: "text-sm text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-secondary text-secondary-foreground",
          error: "border-destructive/40",
          success: "border-accent/40",
        },
      }}
    />
  );
}
