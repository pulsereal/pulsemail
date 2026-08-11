import { useQuery } from "react-query";
import { authAPI } from "../services/api";

export interface Features {
    aiSorting: boolean;
    aiSummaries: boolean;
    aiReplies: boolean;
}

const NONE: Features = {
    aiSorting: false,
    aiSummaries: false,
    aiReplies: false,
};

/**
 * Optional features an administrator has switched on server-side. Read from
 * /auth/me rather than the persisted auth store, so turning a feature off in
 * the admin panel reaches existing sessions without a re-login.
 */
export const useFeatures = (): Features => {
    const { data } = useQuery(
        ["features"],
        () =>
            authAPI
                .getMe()
                .then((response) => (response.data.features ?? NONE) as Features),
        { staleTime: 5 * 60 * 1000, retry: false }
    );

    return data ?? NONE;
};
