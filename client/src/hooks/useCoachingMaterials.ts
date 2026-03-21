import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface CoachingMaterial {
  id: string;
  userId: string;
  title: string;
  content: string;
  type: "principles" | "document";
  createdAt: string;
  updatedAt: string;
}

const QUERY_KEY = ["/api/v1/coaching-materials"];
const RAG_STATUS_KEY = ["/api/v1/coaching-materials/rag-status"];

export interface RagStatus {
  hasApiKey: boolean;
  totalMaterials: number;
  totalChunks: number;
  allEmbedded: boolean;
  materials: {
    id: string;
    title: string;
    type: string;
    contentLength: number;
    chunkCount: number;
    hasEmbeddings: boolean;
  }[];
}

export function useCoachingMaterials() {
  return useQuery<CoachingMaterial[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/v1/coaching-materials");
      return response.json();
    },
  });
}

export function useCreateCoachingMaterial() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: { title: string; content: string; type: "principles" | "document" }) => {
      const response = await apiRequest("POST", "/api/v1/coaching-materials", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: "Coaching material added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add coaching material", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateCoachingMaterial() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; title?: string; content?: string; type?: "principles" | "document" }) => {
      const response = await apiRequest("PATCH", `/api/v1/coaching-materials/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: "Coaching material updated" });
    },
    onError: () => {
      toast({ title: "Failed to update coaching material", variant: "destructive" });
    },
  });
}

export function useRagStatus() {
  return useQuery<RagStatus>({
    queryKey: RAG_STATUS_KEY,
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/v1/coaching-materials/rag-status");
      return response.json();
    },
  });
}

export function useReEmbed() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/v1/coaching-materials/re-embed");
      return response.json();
    },
    onSuccess: (data: { success: boolean; materialsProcessed: number; errors: string[] }) => {
      queryClient.invalidateQueries({ queryKey: RAG_STATUS_KEY });
      if (data.errors?.length > 0) {
        toast({
          title: `Embedded ${data.materialsProcessed} materials with ${data.errors.length} error(s)`,
          description: data.errors[0],
          variant: "destructive",
        });
      } else {
        toast({ title: `Successfully embedded ${data.materialsProcessed} material(s)` });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Failed to re-embed", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteCoachingMaterial() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/v1/coaching-materials/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: "Coaching material removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove coaching material", variant: "destructive" });
    },
  });
}
