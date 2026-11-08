import type { Project, Session } from "@codeden/contracts";
import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useProjectActions } from "@/lib/project-actions";
import { ProjectGroup } from "./project-group";
import type { GroupPosition } from "./project-menu";

/** Drags move up and down only. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

const screenReaderInstructions = {
  draggable:
    "To reorder, press space or enter, move with the up and down arrow keys, then press space or enter to drop, or escape to cancel.",
};

function SortableProject({
  project,
  sessions,
  position,
}: {
  project: Project;
  sessions: Session[];
  position: GroupPosition;
}) {
  const sortable = useSortable({ id: project.id });
  const drag = {
    setNodeRef: sortable.setNodeRef,
    setActivatorNodeRef: sortable.setActivatorNodeRef,
    attributes: sortable.attributes,
    listeners: sortable.listeners,
    style: {
      transform: CSS.Translate.toString(sortable.transform),
      transition: sortable.transition,
    },
    isDragging: sortable.isDragging,
  };
  return <ProjectGroup project={project} sessions={sessions} drag={drag} position={position} />;
}

/**
 * One group of the project list (pinned, or the rest), sortable on its own: projects never
 * cross groups by dragging. Mouse drags start after 6px so clicks still open and expand; the
 * grip in each row's gutter starts a keyboard move.
 */
export function SortableProjectGroup({
  projects,
  sessions,
  label,
}: {
  projects: Project[];
  sessions: Session[];
  /** Group name for screen reader announcements. */
  label: string;
}) {
  const actions = useProjectActions();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = projects.map((p) => p.id);
  const name = (id: UniqueIdentifier) => projects.find((p) => p.id === id)?.name ?? "project";
  const place = (id: UniqueIdentifier) =>
    `position ${ids.indexOf(String(id)) + 1} of ${ids.length} in ${label}`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${name(active.id)} is at ${place(over.id)}.`
        : `${name(active.id)} is outside the list.`,
    onDragEnd: ({ active, over }) =>
      over ? `${name(active.id)} dropped at ${place(over.id)}.` : `${name(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Moving ${name(active.id)} cancelled.`,
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    void actions.moveTo(String(active.id), ids.indexOf(String(over.id)));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      onDragEnd={onDragEnd}
      accessibility={{ announcements, screenReaderInstructions }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {projects.map((project, index) => (
          <SortableProject
            key={project.id}
            project={project}
            sessions={sessions.filter((s) => s.projectId === project.id)}
            position={{ index, count: projects.length }}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}
