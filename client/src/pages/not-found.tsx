import { ArrowLeft, MapPinOff } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div
      className="min-h-full w-full flex items-center justify-center bg-background p-4"
      data-testid="page-not-found"
    >
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
              <MapPinOff className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            This page isn&apos;t on the map
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The page you&apos;re looking for doesn&apos;t exist or may have moved. Your training
            data is safe.
          </p>
          <div className="mt-6 flex justify-center">
            <Button asChild data-testid="button-back-to-training">
              <Link href="/">
                <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
                Back to Training
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
