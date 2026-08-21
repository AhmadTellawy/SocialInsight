import React, { useId, useRef } from 'react';
import { Images, ListChecks, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type CreatorAnswerType = 'text' | 'image' | 'rating';

type AnswerTypeSelectorProps = {
  value: CreatorAnswerType;
  onChange: (value: CreatorAnswerType) => void;
  modes?: CreatorAnswerType[];
  accent?: 'blue' | 'purple' | 'amber';
  className?: string;
};

const modeIcons = {
  text: ListChecks,
  image: Images,
  rating: Star
};

const selectedClasses = {
  blue: 'border-blue-500 bg-blue-50 text-blue-600',
  purple: 'border-purple-500 bg-purple-50 text-purple-600',
  amber: 'border-amber-500 bg-amber-50 text-amber-700'
};

export const AnswerTypeSelector: React.FC<AnswerTypeSelectorProps> = ({
  value,
  onChange,
  modes = ['text', 'image', 'rating'],
  accent = 'blue',
  className = ''
}) => {
  const { t, i18n } = useTranslation();
  const groupId = useId();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const labels: Record<CreatorAnswerType, string> = {
    text: t('answerType.text'),
    image: t('answerType.images'),
    rating: t('answerType.rating')
  };
  const accessibleLabels: Record<CreatorAnswerType, string> = {
    text: t('answerType.textOptions'),
    image: t('answerType.imageOptions'),
    rating: t('answerType.ratingScale')
  };

  const moveSelection = (index: number, delta: number) => {
    const nextIndex = (index + delta + modes.length) % modes.length;
    const nextMode = modes[nextIndex];
    onChange(nextMode);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      id={groupId}
      role="radiogroup"
      aria-orientation="horizontal"
      aria-label={t('answerType.label')}
      className={`grid h-[38px] gap-0.5 rounded-xl border border-gray-100 bg-gray-50/60 p-0.5 ${className}`}
      style={{ gridTemplateColumns: `repeat(${modes.length}, minmax(0, 1fr))` }}
    >
      {modes.map((mode, index) => {
        const Icon = modeIcons[mode];
        const selected = value === mode;
        return (
          <button
            key={mode}
            ref={(element) => { buttonRefs.current[index] = element; }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={accessibleLabels[mode]}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(mode)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                moveSelection(index, i18n.dir() === 'rtl' ? -1 : 1);
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                moveSelection(index, i18n.dir() === 'rtl' ? 1 : -1);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                moveSelection(index, 1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                moveSelection(index, -1);
              }
            }}
            className={`flex h-full min-w-0 items-center justify-center gap-1 rounded-lg border px-1 text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
              selected ? selectedClasses[accent] : 'border-transparent bg-transparent text-gray-600 hover:bg-white'
            }`}
          >
            <Icon size={14} aria-hidden="true" />
            <span className="truncate">{labels[mode]}</span>
          </button>
        );
      })}
    </div>
  );
};
