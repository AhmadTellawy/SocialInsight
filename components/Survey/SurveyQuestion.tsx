import React from 'react';
import { CheckCircle2, X, XCircle, Maximize2, ImageIcon, Star } from 'lucide-react';
import { Survey, SurveyType, Option } from '../../types';
import { useTranslation } from 'react-i18next';
import { getPercentage } from '../../utils/formatters';

interface SurveyQuestionProps {
  sourceSurvey: Survey;
  options: Option[];
  selectedOptions: string[];
  shouldShowResults: boolean;
  hasVoted: boolean;
  isExpired: boolean;
  hasImages: boolean;
  isHorizontal: boolean;
  isRating: boolean;
  isMultiple: boolean;
  totalVotes: number;
  portraitImages: Set<string>;
  followUpAnswers: Record<string, string>;
  onOptionClick: (optionId: string) => void;
  onFollowUpChange: (optionId: string, value: string) => void;
  onImageExpand: (imageUrl: string) => void;
  onDetectOrientation: (imageUrl: string, e: React.SyntheticEvent<HTMLImageElement>) => void;
}

export const SurveyQuestion: React.FC<SurveyQuestionProps> = ({
  sourceSurvey,
  options,
  selectedOptions,
  shouldShowResults,
  hasVoted,
  isExpired,
  hasImages,
  isHorizontal,
  isRating,
  isMultiple,
  totalVotes,
  portraitImages,
  followUpAnswers,
  onOptionClick,
  onFollowUpChange,
  onImageExpand,
  onDetectOrientation
}) => {
  const { t } = useTranslation();
  const isQuiz = sourceSurvey.type === SurveyType.QUIZ;
  const firstQuestion = sourceSurvey.sections?.[0]?.questions?.[0];
  const isTextOnlyPoll = !hasImages && !isRating;

  const renderHorizontal = () => (
    <div className="flex overflow-x-auto snap-x snap-mandatory hide-scrollbar gap-3 pb-4 px-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
      {(options || []).map((option) => {
        const isSelected = selectedOptions.includes(option.id);
        const percentage = shouldShowResults ? getPercentage(option.votes || 0, totalVotes) : 0;
        const isPortrait = option.image && portraitImages.has(option.image);
        const isCorrect = isQuiz && option.isCorrect;
        const isWrongSelection = isQuiz && isSelected && !isCorrect;

        return (
          <div key={option.id} className={`flex-shrink-0 relative w-[65%] sm:w-[250px] rounded-xl border snap-center overflow-hidden flex flex-col transition-all duration-300 bg-white shadow-sm ${shouldShowResults && isCorrect ? 'border-green-500 ring-2 ring-green-500 bg-green-50' : shouldShowResults && isWrongSelection ? 'border-red-500 ring-2 ring-red-500 bg-red-50' : isSelected ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200'}`}>
            <div className="w-full aspect-square bg-gray-100 relative group/opt-img">
              {option.image ? (
                <>
                  <img
                    src={option.image}
                    crossOrigin="anonymous"
                    onLoad={(e) => onDetectOrientation(option.image!, e)}
                    alt={option.text}
                    className="w-full h-full object-cover"
                  />
                  {isPortrait && (
                    <div
                      className="absolute inset-0 bg-black/10 opacity-0 group-hover/opt-img:opacity-100 flex items-center justify-center transition-opacity cursor-zoom-in"
                      onClick={(e) => {
                        e.stopPropagation();
                        onImageExpand(option.image!);
                      }}
                    >
                      <Maximize2 size={24} className="text-white drop-shadow-md" />
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-300">
                  <ImageIcon size={38} />
                </div>
              )}
              {isSelected && !hasVoted && !isExpired && (
                <div className="absolute inset-0 bg-blue-500/10 flex items-center justify-center animate-in fade-in duration-200 pointer-events-none">
                  <div className="bg-blue-500 text-white p-2 rounded-full shadow-lg"><CheckCircle2 size={24} /></div>
                </div>
              )}
              {shouldShowResults && isCorrect && (
                <div className="absolute inset-0 flex items-center justify-center animate-in fade-in duration-200 pointer-events-none bg-green-500/10">
                  <div className="bg-green-500 text-white p-2 rounded-full shadow-lg"><CheckCircle2 size={24} /></div>
                </div>
              )}
              {shouldShowResults && isWrongSelection && (
                <div className="absolute inset-0 flex items-center justify-center animate-in fade-in duration-200 pointer-events-none bg-red-500/10">
                  <div className="bg-red-500 text-white p-2 rounded-full shadow-lg"><X size={24} /></div>
                </div>
              )}
            </div>
            <div className="bg-gray-50 p-4 border-t border-gray-100 flex-1 flex flex-col justify-center min-h-[80px]">
              <div className="flex justify-between items-center gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-gray-900 truncate text-base leading-snug">
                    {option.isRating ? (
                      <div className="flex text-yellow-500">
                        {Array.from({ length: option.ratingValue || 0 }).map((_, i) => (
                          <Star key={i} size={14} fill="currentColor" />
                        ))}
                      </div>
                    ) : option.text}
                  </h3>
                  {shouldShowResults && <div className="text-[10px] text-gray-500 mt-1">{option.votes.toLocaleString()} {t('votes')}</div>}
                </div>
                <div className="shrink-0">
                  {isCorrect && (hasVoted || isExpired) && (
                    <CheckCircle2 size={18} className="text-green-600 shrink-0" />
                  )}
                  {isWrongSelection && (hasVoted || isExpired) && (
                    <X size={18} className="text-red-600 shrink-0" />
                  )}
                  {!hasVoted && !isExpired ? (
                    <button onClick={() => onOptionClick(option.id)} className={`text-sm font-bold px-6 py-2 rounded-lg transition-colors border shadow-sm active:scale-95 ${isSelected ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-100'}`}>{isSelected && isMultiple ? t('Selected') : t('Vote')}</button>
                  ) : (
                    isSelected ? (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 text-blue-600 font-bold text-[11px] bg-blue-50 px-2 py-1 rounded-full whitespace-nowrap">
                          <CheckCircle2 size={12} /> <span>{t('Voted')}</span>
                        </div>
                        {shouldShowResults && <span className="text-sm text-blue-700 font-extrabold">{percentage}%</span>}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400 font-bold px-2">{percentage}%</span>
                    )
                  )}
                </div>
              </div>
              {shouldShowResults && <div className="mt-3 animate-in fade-in slide-in-from-bottom-1 duration-500"><div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full transition-all duration-700 ease-out" style={{ width: `${percentage}%` }} /></div></div>}
            </div>

            {/* Horizontal Clarification Question */}
            {isSelected && !hasVoted && option.withFollowUp && (
              <div className="p-4 pt-0 animate-in fade-in slide-in-from-top-1">
                <label className="text-[11px] font-black text-blue-600 uppercase tracking-widest mb-1.5 block">{option.followUpLabel || t('Please explain:')}</label>
                <textarea
                  value={followUpAnswers[option.id] || ''}
                  onChange={(e) => onFollowUpChange(option.id, e.target.value)}
                  placeholder={t('Your response...')}
                  className="w-full p-3 text-sm bg-blue-50/50 border border-blue-100 rounded-xl focus:bg-white transition-all min-h-[60px] resize-none"
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  );

  const renderVertical = () => (
    <div className={isTextOnlyPoll ? "space-y-2.5" : "space-y-2"}>
      {(options || []).map((option, idx) => {
        const isSelected = selectedOptions.includes(option.id);
        const percentage = shouldShowResults ? getPercentage(option.votes || 0, totalVotes) : 0;
        const optionVotes = option.votes || 0;
        const isPortrait = option.image && portraitImages.has(option.image);
        const isCorrect = isQuiz && option.isCorrect;
        const isWrongSelection = isQuiz && isSelected && !isCorrect;
        
        if (isTextOnlyPoll) {
          let resultColor = 'bg-gray-300';
          let borderColor = 'border-gray-200';
          let textColor = 'text-gray-900';
          let percentageTextColor = isSelected ? 'text-blue-600' : 'text-gray-900';
          let icon = null;

          if (isQuiz && shouldShowResults) {
            if (isCorrect) {
              resultColor = 'bg-green-500';
              borderColor = 'border-green-500';
              textColor = 'text-green-700';
              percentageTextColor = 'text-green-600';
              icon = <CheckCircle2 size={18} className="text-green-500" fill="currentColor" stroke="white" />;
            } else if (isWrongSelection) {
              resultColor = 'bg-red-500';
              borderColor = 'border-red-500';
              textColor = 'text-red-700';
              percentageTextColor = 'text-red-600';
              icon = <XCircle size={18} className="text-red-500" fill="currentColor" stroke="white" />;
            } else if (isSelected) {
              resultColor = 'bg-blue-600';
              borderColor = 'border-blue-500';
              textColor = 'text-blue-700';
              percentageTextColor = 'text-blue-600';
              icon = <CheckCircle2 size={18} className="text-blue-600" fill="currentColor" stroke="white" />;
            } else {
              icon = <div className="w-[18px] h-[18px] rounded-full border-2 border-gray-300 group-hover:border-blue-400 transition-colors" />;
            }
          } else {
            if (isSelected) {
              resultColor = 'bg-blue-600';
              borderColor = 'border-blue-500';
              textColor = 'text-blue-700';
              percentageTextColor = 'text-blue-600';
              icon = <CheckCircle2 size={18} className="text-blue-600" fill="currentColor" stroke="white" />;
            } else {
              icon = <div className="w-[18px] h-[18px] rounded-full border-2 border-gray-300 group-hover:border-blue-400 transition-colors" />;
            }
          }

          const buttonState = hasVoted || isExpired
            ? isSelected || (isQuiz && shouldShowResults && isCorrect)
              ? `${borderColor} ring-1 ring-black/5 bg-white`
              : 'border-gray-200 bg-white opacity-70'
            : isSelected
              ? `${borderColor} ring-1 ring-blue-500/20 bg-white shadow-sm`
              : 'border-gray-200 bg-white hover:border-blue-400/50 hover:bg-gray-50/50 active:scale-[0.99]';

          return (
            <div key={option.id} className="flex flex-col gap-2">
              <button
                onClick={() => onOptionClick(option.id)}
                disabled={hasVoted || isExpired}
                className={`relative w-full text-left rounded-2xl border transition-all duration-300 overflow-hidden group ${buttonState}`}
              >
                <div className="relative z-10 px-4 py-3">
                  <div className="flex items-center gap-3">
                    {/* Left Icon */}
                    <div className="shrink-0">
                      {icon}
                    </div>

                    {/* Center Content: Text & Progress Bar */}
                    <div className="min-w-0 flex-1 flex flex-col justify-center">
                      <span className={`block text-[13px] font-medium leading-snug line-clamp-2 break-words ${textColor}`}>
                        {option.text}
                      </span>
                      
                      {shouldShowResults && (
                        <div className="mt-2.5 animate-in fade-in slide-in-from-bottom-1 duration-500">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                            <div
                              className={`h-full rounded-full transition-all duration-700 ease-out ${resultColor}`}
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Right Content: Stats */}
                    <div className="shrink-0 pl-3">
                      {hasVoted || isExpired ? (
                        shouldShowResults ? (
                          <div className="flex flex-col items-end gap-1">
                            <span className={`text-[13px] font-medium leading-none ${percentageTextColor}`}>
                              {percentage}%
                            </span>
                            <span className="text-[11px] font-medium text-gray-500 leading-none whitespace-nowrap">
                              {optionVotes.toLocaleString()} {optionVotes === 1 ? t('vote') : t('votes')}
                            </span>
                          </div>
                        ) : null
                      ) : null}
                    </div>
                  </div>
                </div>
              </button>

              {isSelected && !hasVoted && option.withFollowUp && (
                <div className="px-2 pb-3 pt-1 animate-in fade-in slide-in-from-top-1">
                  <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-2xl">
                    <label className="text-[11px] font-black text-blue-600 uppercase tracking-widest mb-2 block">
                      {option.followUpLabel || t('Please explain your choice:')}
                    </label>
                    <textarea
                      value={followUpAnswers[option.id] || ''}
                      onChange={(e) => onFollowUpChange(option.id, e.target.value)}
                      placeholder={t('Type your response...')}
                      className="w-full p-3 text-sm bg-white border border-blue-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all min-h-[90px] resize-none shadow-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        }

        return (
          <div key={option.id} className="flex flex-col gap-2">
            <button onClick={() => onOptionClick(option.id)} disabled={hasVoted || isExpired} className={`relative w-full text-left rounded-xl border transition-all duration-300 overflow-hidden group ${hasImages ? 'p-1 pr-3' : 'p-3'} ${hasVoted || isExpired ? (isCorrect ? 'border-green-500 bg-green-50' : isWrongSelection ? 'border-red-500 bg-red-50' : isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-gray-50') : isSelected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500/20' : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/30 active:scale-[0.99]'}`}>
              {shouldShowResults && <div className={`absolute top-0 left-0 bottom-0 transition-all duration-1000 ease-out ${isCorrect ? 'bg-green-200/50' : isWrongSelection ? 'bg-red-200/50' : isSelected ? 'bg-blue-100/50' : 'bg-gray-200/50'}`} style={{ width: `${percentage}%` }} />}
              <div className={`relative flex justify-between items-center z-10 ${hasImages ? 'min-h-[44px]' : ''}`}>
                <div className={`flex items-center overflow-hidden ${hasImages ? 'gap-3' : 'gap-3'}`}>
                  {hasImages && (
                    <div
                      className="w-16 h-16 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0 overflow-hidden relative group/opt-img"
                      onClick={(e) => {
                        if (isPortrait) {
                          e.stopPropagation();
                          onImageExpand(option.image!);
                        }
                      }}
                    >
                      {option.image ? (
                        <>
                          <img
                            src={option.image}
                            crossOrigin="anonymous"
                            onLoad={(e) => onDetectOrientation(option.image!, e)}
                            alt=""
                            className="w-full h-full object-cover transition-transform group-hover/opt-img:scale-110"
                          />
                          {isPortrait && (
                            <div className="absolute inset-0 bg-black/10 opacity-0 group-hover/opt-img:opacity-100 flex items-center justify-center transition-opacity cursor-zoom-in">
                              <Maximize2 size={14} className="text-white drop-shadow-sm" />
                            </div>
                          )}
                        </>
                      ) : (
                        <ImageIcon size={24} className="text-gray-300" />
                      )}
                    </div>
                  )}

                  {isRating ? (
                    <div className="flex items-center gap-2">
                      <div className="flex text-yellow-500">
                        {Array.from({ length: option.ratingValue || 0 }).map((_, i) => (
                          <Star key={i} size={18} fill="currentColor" />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <span className={`font-medium text-sm truncate ${isSelected ? 'text-blue-700' : 'text-gray-700'} ${hasImages ? 'py-1' : ''}`}>{option.text}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 pl-2 shrink-0">
                  {hasVoted || isExpired ? (shouldShowResults ? <span className="text-xs font-bold text-gray-500">{percentage}%</span> : isSelected && <CheckCircle2 size={16} className="text-blue-600" />) : <div className={`w-4 h-4 rounded-full border-2 transition-colors flex items-center justify-center ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300 group-hover:border-blue-400 group-hover:bg-blue-400/20'}`}>{isSelected && <div className="w-1.5 h-1.5 bg-white rounded-full" />}</div>}
                </div>
              </div>
            </button>

            {/* Vertical Clarification Question */}
            {isSelected && !hasVoted && option.withFollowUp && (
              <div className="px-2 pb-3 pt-1 animate-in fade-in slide-in-from-top-1">
                <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-2xl">
                  <label className="text-[11px] font-black text-blue-600 uppercase tracking-widest mb-2 block">
                    {option.followUpLabel || t('Please explain your choice:')}
                  </label>
                  <textarea
                    value={followUpAnswers[option.id] || ''}
                    onChange={(e) => onFollowUpChange(option.id, e.target.value)}
                    placeholder={t('Type your response...')}
                    className="w-full p-3 text-sm bg-white border border-blue-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all min-h-[90px] resize-none shadow-sm"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className={isTextOnlyPoll ? "mb-2" : "mb-4"}>
      {isQuiz && firstQuestion?.image && (
        <div className="w-full rounded-xl overflow-hidden mb-3 bg-gray-100">
          <img src={firstQuestion.image} crossOrigin="anonymous" className="w-full max-h-[500px] object-cover block" alt="Question context" />
        </div>
      )}
      {isHorizontal ? renderHorizontal() : renderVertical()}
    </div>
  );
};
