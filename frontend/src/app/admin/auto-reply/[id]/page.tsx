'use client';

import { useParams } from 'next/navigation';
import FlowEditorPage from '@/components/auto-reply/FlowEditorPage';

export default function EditAutoReplyFlowPage() {
  const params = useParams<{ id: string }>();
  return <FlowEditorPage flowId={params.id} />;
}

