import { TooltipProvider } from "../ui";
import { TitleBar } from "./TitleBar";
import { DevGallery } from "./dev/DevGallery";

/**
 * Root of the rebuilt UI. Phase 0 only shows the primitives gallery; the auth gate
 * and real shell replace it in Phase 1 (see docs/ui-rework-plan.md).
 */
export default function NewApp() {
  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-orbit-base text-orbit-text">
        <TitleBar title="Orbit Chat — new UI preview" />
        <DevGallery />
      </div>
    </TooltipProvider>
  );
}
