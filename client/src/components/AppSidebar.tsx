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
import { MessageSquare, Plus, Settings, CalendarRange, LogOut } from "lucide-react";
import { useLocation, Link } from "wouter";
import { ThemeToggle } from "./ThemeToggle";
import { useAuth } from "@/hooks/useAuth";

const menuItems = [
  { title: "Coach", url: "/", icon: MessageSquare },
  { title: "Timeline", url: "/timeline", icon: CalendarRange },
  { title: "Log Workout", url: "/log", icon: Plus },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();

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
      <SidebarFooter className="p-4 space-y-3">
        <div className="flex items-center gap-3 px-2">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user?.profileImageUrl || undefined} alt={userName} className="object-cover" />
            <AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" data-testid="text-user-name">{userName}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <SidebarMenuButton asChild data-testid="nav-settings">
            <Link href="/settings" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </Link>
          </SidebarMenuButton>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="icon" asChild data-testid="button-logout">
              <a href="/api/logout" title="Log out">
                <LogOut className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
