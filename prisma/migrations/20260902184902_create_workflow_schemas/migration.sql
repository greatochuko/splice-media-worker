-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('tiktok', 'youtube', 'instagram', 'facebook', 'linkedin');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('success', 'failed', 'pending');

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerPlatform" "Platform" NOT NULL,
    "triggerEvent" TEXT NOT NULL DEFAULT 'New Video Published',
    "actionPlatform" "Platform" NOT NULL,
    "actionEvent" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "totalExecutions" INTEGER NOT NULL DEFAULT 0,
    "lastRun" TIMESTAMP(3),
    "removeWatermark" BOOLEAN NOT NULL DEFAULT true,
    "autoPublish" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowLog" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "videoDuration" TEXT,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'pending',
    "sourcePlatform" "Platform" NOT NULL,
    "targetPlatform" "Platform" NOT NULL,
    "targetUrl" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Workflow_workspaceId_idx" ON "Workflow"("workspaceId");

-- CreateIndex
CREATE INDEX "Workflow_isActive_idx" ON "Workflow"("isActive");

-- CreateIndex
CREATE INDEX "WorkflowLog_workflowId_idx" ON "WorkflowLog"("workflowId");

-- CreateIndex
CREATE INDEX "WorkflowLog_status_idx" ON "WorkflowLog"("status");

-- CreateIndex
CREATE INDEX "WorkflowLog_createdAt_idx" ON "WorkflowLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowLog" ADD CONSTRAINT "WorkflowLog_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
