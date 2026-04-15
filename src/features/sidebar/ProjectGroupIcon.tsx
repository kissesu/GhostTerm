import { BriefcaseBusiness, Folder, Folders } from 'lucide-react';
import type { ProjectGroupIcon as ProjectGroupIconName } from './projectGroupingStore';

interface ProjectGroupIconProps {
  icon: ProjectGroupIconName;
  size?: number;
  color?: string;
}

export default function ProjectGroupIcon({
  icon,
  size = 18,
  color = '#eef0ff',
}: ProjectGroupIconProps) {
  if (icon === 'folders') {
    return <Folders size={size} color={color} />;
  }

  if (icon === 'folder') {
    return <Folder size={size} color={color} />;
  }

  return <BriefcaseBusiness size={size} color={color} />;
}
