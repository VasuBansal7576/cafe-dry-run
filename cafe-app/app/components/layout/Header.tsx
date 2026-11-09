import {
  useHeaderTitle,
  useHeaderActions,
} from "@agent-native/toolkit/app-shell";
import { AgentToggleButton } from "@agent-native/toolkit/app/chat";

import { MobileAppBar } from "./MobileAppBar";

export function Header() {
  const title = useHeaderTitle();
  const actions = useHeaderActions();

  return (
    <MobileAppBar
      className="md:ps-4"
      title={title}
      actions={
        <>
          {actions}
          <AgentToggleButton />
        </>
      }
    />
  );
}
