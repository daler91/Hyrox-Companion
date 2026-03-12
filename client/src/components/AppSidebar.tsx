import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Settings, CalendarRange, LogOut, BarChart3 } from "lucide-react";
import { useLocation, Link } from "wouter";
import { ThemeToggle } from "./ThemeToggle";
import { useAuth } from "@/hooks/useAuth";
import { useSignOut } from "@/hooks/useSignOut";

const menuItems = [
  { title: "Training", url: "/", icon: CalendarRange },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();
  const signOut = useSignOut();

  const userInitials = user 
    ? `${user.firstName?.charAt(0) || ''}${user.lastName?.charAt(0) || ''}`.toUpperCase() || user.email?.charAt(0).toUpperCase() || 'U'
    : 'U';

  const userName = user
    ? user.firstName && user.lastName 
      ? `${user.firstName} ${user.lastName}`
      : user.email || 'User'
    : 'User';

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">H</span>
          </div>
          <span className="font-bold text-lg">HyroxTracker</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
            <Button variant="ghost" size="icon" asChild data-testid="nav-settings" aria-label="Settings">
              <Link href="/settings" title="Settings">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
            <ThemeToggle />
            <Button variant="ghost" size="icon" data-testid="button-logout" aria-label="Log out" onClick={() => signOut()} title="Log out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
