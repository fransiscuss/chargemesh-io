export type ShutdownSteps = {
  stopAccepting: () => void;
  closeSessions: (code: number) => Promise<void>;
  flush: () => Promise<void>;
  exit: () => void | Promise<void>;
};
export async function shutdown(steps: ShutdownSteps): Promise<void> {
  steps.stopAccepting();
  await steps.closeSessions(1001);
  await steps.flush();
  await steps.exit();
}
