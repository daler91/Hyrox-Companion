export function StepFooter({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      className={
        "fixed inset-x-0 bottom-0 z-40 flex flex-col-reverse gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur " +
        "md:static md:flex-row md:justify-end md:border-0 md:bg-transparent md:p-0 md:pt-2 md:backdrop-blur-none"
      }
      data-testid="step-footer"
    >
      {children}
    </div>
  );
}
