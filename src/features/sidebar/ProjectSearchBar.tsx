import { Search } from 'lucide-react';

interface ProjectSearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export default function ProjectSearchBar({ value, onChange }: ProjectSearchBarProps) {
  return (
    <div
      style={{
        padding: '12px',
      }}
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          height: 52,
          borderRadius: 16,
          border: '1px solid #45495f',
          background: '#24273a',
          padding: '0 16px',
        }}
      >
        <Search size={24} color="#9ea3bd" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="搜索 (:active)"
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: '#eef0ff',
            fontSize: 16,
          }}
          data-testid="project-search-input"
        />
      </label>
    </div>
  );
}
