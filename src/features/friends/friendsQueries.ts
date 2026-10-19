import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../../lib/api";
import { useAuthStore } from "../../stores/authStore";
import { useSocketStore } from "../../stores/socketStore";

export const friendsKey = ["friends"] as const;

export type FriendsData = { friends: api.FriendListItem[]; requests: api.FriendRequestsResponse };
export type Relation = "self" | "friend" | "incoming" | "outgoing" | "none";

/** Friends and pending requests, refreshed on window focus and when the server says they changed. */
export function useFriends() {
  const token = useAuthStore((s) => s.token);
  const socket = useSocketStore((s) => s.socket);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: friendsKey,
    enabled: Boolean(token),
    staleTime: 30_000,
    queryFn: async (): Promise<FriendsData> => {
      const t = useAuthStore.getState().token!;
      const [friends, requests] = await Promise.all([api.getFriends(t), api.getFriendRequests(t)]);
      return { friends, requests };
    }
  });

  useEffect(() => {
    if (!socket) return;
    const invalidate = () => void queryClient.invalidateQueries({ queryKey: friendsKey });
    socket.on("friendships_updated", invalidate);
    return () => {
      socket.off("friendships_updated", invalidate);
    };
  }, [socket, queryClient]);

  return query;
}

/** How the signed-in user relates to each other user, plus the request id needed to act on it. */
export function relationFor(data: FriendsData | undefined, userId: string, myUserId: string) {
  if (userId === myUserId) return { relation: "self" as Relation, requestId: null };
  if (data?.friends.some((f) => f.user.id === userId)) return { relation: "friend" as Relation, requestId: null };
  const incoming = data?.requests.incoming.find((r) => r.user.id === userId);
  if (incoming) return { relation: "incoming" as Relation, requestId: incoming.id };
  const outgoing = data?.requests.outgoing.find((r) => r.user.id === userId);
  if (outgoing) return { relation: "outgoing" as Relation, requestId: outgoing.id };
  return { relation: "none" as Relation, requestId: null };
}

export function useRelations() {
  const { data } = useFriends();
  const myUserId = useAuthStore((s) => s.user?.id ?? "");
  return useMemo(() => (userId: string) => relationFor(data, userId, myUserId), [data, myUserId]);
}

type FriendAction =
  | { kind: "send"; userId: string }
  | { kind: "accept"; requestId: string }
  | { kind: "decline"; requestId: string }
  | { kind: "cancel"; requestId: string }
  | { kind: "remove"; userId: string };

export function useFriendAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: FriendAction) => {
      const token = useAuthStore.getState().token;
      if (!token) throw new Error("Not signed in.");
      switch (action.kind) {
        case "send":
          return api.sendFriendRequest(action.userId, token);
        case "accept":
          return api.acceptFriendRequest(action.requestId, token);
        case "decline":
          return api.declineFriendRequest(action.requestId, token);
        case "cancel":
          return api.cancelFriendRequest(action.requestId, token);
        case "remove":
          return api.removeFriend(action.userId, token);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: friendsKey })
  });
}
