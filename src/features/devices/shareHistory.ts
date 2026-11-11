import * as api from "../../lib/api";
import { networkIssuerLookup, openConversationKeys, sealForDevices } from "../../lib/conversationKeys";
import { getOwnDevices } from "../../lib/deviceIdentity";
import { devLog } from "../../lib/devLogger";
import { getPlatform } from "../../platform";
import { useE2EEStore } from "../../stores/e2eeStore";

/**
 * After linking (mobile plan B7), the trusted device re-seals every conversation key it holds for
 * the new device, signed by itself, through `POST /keys/device-batch` (write-once, so a repeat is
 * harmless). It can take a while with many chats, so it runs after the linking session closes and
 * is remembered until done: an interrupted share resumes on the next sign-in.
 */

const pendingSharesKey = (userId: string) => `orbit:historyShares:${userId}`;
const BATCH_SIZE = 500;
const shareInFlight = new Map<string, Promise<void>>();

async function readPending(userId: string): Promise<string[]> {
  const raw = await getPlatform().secureStore.get(pendingSharesKey(userId));
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

async function writePending(userId: string, ids: string[]) {
  const store = getPlatform().secureStore;
  if (ids.length) await store.set(pendingSharesKey(userId), JSON.stringify([...new Set(ids)]));
  else await store.remove(pendingSharesKey(userId));
}

async function shareOnce(userId: string, token: string, deviceId: string) {
  const e2ee = useE2EEStore.getState();
  const me = await e2ee.thisDevice(userId, token);
  const target = (await getOwnDevices(userId, token)).devices.find((d) => d.deviceId === deviceId);
  if (!target) return; // no longer linked: nothing to give it
  const issuers = networkIssuerLookup(userId, token);
  const conversations = await api.getConversations(token);
  let failures = 0;

  for (const conversation of conversations) {
    try {
      const rows = await api.getMyConversationKeys(conversation.id, token);
      const opened = await openConversationKeys({
        rows,
        conversation: { id: conversation.id, members: conversation.members.map((m) => ({ userId: m.userId })) },
        me,
        allowLegacy: false,
        issuers,
      });
      const floor = conversation.members.find((m) => m.userId === userId)?.minReadableKeyVersion ?? 1;
      const keys: Array<api.DeviceKeyInput & { conversationId: string; keyVersion: number }> = [];
      for (const [versionText, secretKey] of Object.entries(opened.byVersion)) {
        const keyVersion = Number(versionText);
        if (keyVersion < floor) continue;
        // A newest key this device wouldn't send with (e.g. issued by a member who has left) is
        // left out: re-signed by this device, the new one would take it as safe to send with.
        if (keyVersion === opened.newestVersion && !opened.newestSendable) continue;
        const sealed = await sealForDevices({
          conversationId: conversation.id,
          keyVersion,
          secretKey,
          devices: [target],
          signingPrivateKey: me.signingPrivateKey,
        });
        for (const key of sealed) keys.push({ ...key, conversationId: conversation.id, keyVersion });
      }
      for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        await api.storeDeviceKeyBatch(keys.slice(i, i + BATCH_SIZE), token);
      }
    } catch (err) {
      failures += 1;
      devLog.warn(`Sharing keys for conversation ${conversation.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures) throw new Error(`${failures} chat(s) couldn't be shared with the new device`);
}

/** Share every key this device holds with a newly linked device; remembered until it succeeds. */
export function shareHistoryWithDevice(userId: string, token: string, deviceId: string): Promise<void> {
  const key = `${userId}:${deviceId}`;
  const pending = shareInFlight.get(key);
  if (pending) return pending;
  const run = (async () => {
    await writePending(userId, [...(await readPending(userId)), deviceId]);
    try {
      await shareOnce(userId, token, deviceId);
      await writePending(userId, (await readPending(userId)).filter((id) => id !== deviceId));
    } catch (err) {
      devLog.warn(`History share with ${deviceId} is incomplete and will resume next sign-in: ${err instanceof Error ? err.message : String(err)}`);
    }
  })().finally(() => shareInFlight.delete(key));
  shareInFlight.set(key, run);
  return run;
}

/** Finish any share an earlier session started. */
export async function resumeHistoryShares(userId: string, token: string) {
  for (const deviceId of await readPending(userId)) await shareHistoryWithDevice(userId, token, deviceId);
}
