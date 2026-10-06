import { LogOut } from "lucide-react";
import { Link, useLocation } from "wouter";

import { ConfirmDialog } from "@/components/timeline/ConfirmDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useConfirmedSignOut } from "@/hooks/useSignOut";
import { getUserDisplayName } from "@/lib/authUtils";
import { navTestId, PRIMARY_NAV_ITEMS } from "@/lib/navItems";

import { Logo } from "./brand/Logo";
import { ThemeToggle } from "./ThemeToggle";

/** What signing out now would lose: the writes still queued on this device (CL61). */
function unsyncedChangesWarning(count: number): string {
  const changes = count === 1 ? "1 change you made" : `${count} changes you made`;
  const reached = count === 1 ? "hasn't reached" : "haven't reached";
  const them = count === 1 ? "it" : "them";
  return `${changes} offline ${reached} the server yet. Signing out now deletes ${them} from this device. Stay signed in and the app keeps trying to sync.`;
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { requestSignOut, confirmingSignOut, pendingWrites, confirmSignOut, cancelSignOut } = useConfirmedSignOut();

  const userInitials = user
    ? `${user.firstName?.charAt(0) || ''}${user.lastName?.charAt(0) || ''}`.toUpperCase() || user.email?.charAt(0).toUpperCase() || 'U'
    : 'U';

  const userName = getUserDisplayName(user);

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Logo size={32} />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Main navigation">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {PRIMARY_NAV_ITEMS.map((item) => {
                  const isActive = location === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        data-testid={navTestId("nav", item.title)}
                      >
                        <Link
                          href={item.url}
                          aria-current={isActive ? "page" : undefined}
                        >
                          <item.icon className="h-4 w-4" aria-hidden="true" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar className="h-7 w-7">
              <AvatarImage src={user?.profileImageUrl || undefined} alt={userName} className="object-cover" />
              <AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium truncate" data-testid="text-user-name">{userName}</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" data-testid="button-logout" aria-label="Log out" onClick={() => requestSignOut()}>
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Log out</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </SidebarFooter>
      <ConfirmDialog
        open={confirmingSignOut}
        onOpenChange={(open) => {
          if (!open) cancelSignOut();
        }}
        title="Sign out with unsynced changes?"
        description={unsyncedChangesWarning(pendingWrites)}
        confirmText="Sign out anyway"
        cancelText="Stay signed in"
        onConfirm={() => confirmSignOut()}
        isDestructive
        cancelTestId="button-cancel-logout"
        confirmTestId="button-confirm-logout"
      />
    </Sidebar>
  );
}
