import { useLocalSearchParams } from 'expo-router';

import { PlanEditor } from '@/components/plans';

/** Write or edit the plan for a scheduled lesson (id = the lesson). */
export default function LessonPlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PlanEditor lessonId={id} />;
}
