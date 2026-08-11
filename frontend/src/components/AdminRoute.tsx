import { Navigate, Outlet } from "react-router-dom";
import { LockClosedIcon } from "@heroicons/react/24/outline";
import { useAuthStore } from "../stores/authStore";
import EmptyState from "./common/EmptyState";

/**
 * Blocks admin-only surfaces at the route level rather than letting the page
 * mount and bail out on its own.
 */
const AdminRoute = () => {
    const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
    const isAdmin = useAuthStore((state) => Boolean(state.user?.isAdmin));

    if (!isAuthenticated) return <Navigate to="/login" replace />;

    if (!isAdmin) {
        return (
            <EmptyState
                icon={LockClosedIcon}
                title="Administrator access required"
                description="This area is limited to iRedMail domain administrators. Contact your administrator if you believe you should have access."
            />
        );
    }

    return <Outlet />;
};

export default AdminRoute;
