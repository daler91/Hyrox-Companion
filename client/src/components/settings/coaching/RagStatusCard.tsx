import { AlertCircle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCoachingMaterials,useRagStatus, useReEmbed } from "@/hooks/useCoachingMaterials";

export function RagStatusCard() {
  const { data: materials } = useCoachingMaterials();
  const { data: ragStatus, isLoading: ragLoading, error: ragError } = useRagStatus();
  const reEmbedMutation = useReEmbed();

  if (!materials || materials.length === 0) return null;

  const getStatusBadge = () => {
    if (!ragStatus) return null;
    if (ragStatus.allEmbedded) {
      return (
        <Badge variant="outline" className="text-green-600 border-green-600">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Active
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-yellow-600 border-yellow-600">
        <AlertCircle className="h-3 w-3 mr-1" />
        Incomplete
      </Badge>
    );
  };

  let content: React.ReactNode;
  if (ragLoading) {
    content = (
      <div className="flex items-center justify-center py-2">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (ragError) {
    const errorMessage = ragError instanceof Error ? ragError.message : "An unexpected error occurred";
    content = (
      <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 text-destructive text-sm">
        <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Failed to load RAG status</p>
          <p className="text-xs mt-0.5">{errorMessage}</p>
        </div>
      </div>
    );
  } else if (ragStatus) {
    content = (
          <>
            {!ragStatus.hasApiKey && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-destructive/10 text-destructive text-sm">
                <XCircle className="h-4 w-4 shrink-0" />
                GEMINI_API_KEY is not configured. Embeddings cannot be generated.
              </div>
            )}

            {ragStatus.embeddingApi && !ragStatus.embeddingApi.ok && ragStatus.hasApiKey && (
              <div className="flex items-start gap-2 p-2 rounded-md bg-destructive/10 text-destructive text-sm">
                <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Embedding API error</p>
                  <p className="text-xs mt-0.5 break-all">{ragStatus.embeddingApi.error}</p>
                </div>
              </div>
            )}

            {ragStatus.dimensionMismatch && (
              <div className="flex items-start gap-2 p-2 rounded-md bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Embedding dimension mismatch</p>
                  <p className="text-xs mt-0.5">
                    Stored: {ragStatus.storedDimension}-dim, expected: {ragStatus.expectedDimension}-dim.
                    Click Re-embed All to fix.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-2 rounded-md bg-muted">
                <p className="text-lg font-semibold">{ragStatus.totalMaterials}</p>
                <p className="text-xs text-muted-foreground">Materials</p>
              </div>
              <div className="p-2 rounded-md bg-muted">
                <p className="text-lg font-semibold">{ragStatus.totalChunks}</p>
                <p className="text-xs text-muted-foreground">Chunks</p>
              </div>
              <div className="p-2 rounded-md bg-muted">
                <p className="text-lg font-semibold">
                  {ragStatus.materials.filter((m) => m.hasEmbeddings).length}/{ragStatus.totalMaterials}
                </p>
                <p className="text-xs text-muted-foreground">Embedded</p>
              </div>
            </div>

            {ragStatus.embeddingApi?.ok && (
              <div className="flex items-center gap-2 p-2 rounded-md bg-green-500/10 text-green-700 dark:text-green-400 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Embedding API working ({ragStatus.embeddingApi.dimension}-dim)
              </div>
            )}

            <div className="space-y-1.5">
              {ragStatus.materials.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-sm px-2 py-1.5 rounded border">
                  <span className="truncate mr-2">{m.title}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {m.chunkCount} chunks
                    </span>
                    {m.hasEmbeddings ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => reEmbedMutation.mutate()}
              disabled={reEmbedMutation.isPending}
            >
              {reEmbedMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Re-embed All
            </Button>
          </>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          RAG Status
          {getStatusBadge()}
        </CardTitle>
        <CardDescription>
          Embedding status for AI-powered document retrieval
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {content}
      </CardContent>
    </Card>
  );
}
