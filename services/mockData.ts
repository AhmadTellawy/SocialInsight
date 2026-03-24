
import { Survey, SurveyType, Comment, Option, SurveySection, SurveyQuestion, Notification, AccountType } from '../types';

// --- 1. Realistic User Personas ---
const MOCK_USERS: { name: string; avatar: string; type: AccountType }[] = [
  { name: 'Tech Insider', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop', type: 'Business' },
  { name: 'ريم القحطاني', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop', type: 'Personal' },
  { name: 'أحمد الفارس', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop', type: 'Personal' },
  { name: 'نورة السعيد', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop', type: 'Personal' },
  { name: 'ياسين علي', avatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=200&h=200&fit=crop', type: 'Personal' },
  { name: 'Eco Warrior', avatar: 'https://images.unsplash.com/photo-1542601906990-b4d3fb7d5763?w=200&h=200&fit=crop', type: 'Group' },
  { name: 'ليلى منصور', avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=200&h=200&fit=crop', type: 'Personal' },
  { name: 'Global Traveler', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop', type: 'Business' },
  { name: 'خالد بن فيصل', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop', type: 'Personal' },
  { name: 'Sports Analytics', avatar: 'https://images.unsplash.com/photo-1557992260-ec58e38d363c?w=200&h=200&fit=crop', type: 'Group' }
];

// --- 2. Huge Diversity of Realistic Topics ---

const ARABIC_TOPICS = [
  // Polls
  { type: SurveyType.POLL, title: "أفضل تطبيق لطلب القهوة في السعودية؟", opts: ["نعناع", "بارنز", "دبليو كوفي", "تطبيقات التوصيل العامة"], cat: "نمط الحياة" },
  { type: SurveyType.POLL, title: "مستقبل السينما السعودية في 2024", opts: ["نمو هائل", "تطور تدريجي", "تحتاج دعماً أكبر", "مستقرة حالياً"], cat: "ترفيه" },
  { type: SurveyType.POLL, title: "تفضيلات العمل في القطاع الخاص أم الحكومي؟", opts: ["القطاع الخاص (رواتب أعلى)", "القطاع الحكومي (أمان وظيفي)", "العمل الحر", "ريادة الأعمال"], cat: "أعمال" },
  { type: SurveyType.POLL, title: "أجمل مدينة لقضاء شهر العسل في الخليج؟", opts: ["دبي", "صلالة", "الدوحة", "نيوم (مستقبلاً)"], cat: "سفر" },
  { type: SurveyType.POLL, title: "هل تعتمد على الذكاء الاصطناعي في دراستك؟", opts: ["دائماً", "أحياناً", "نادراً", "لا أثق به"], cat: "تعليم" },
  
  // Quizzes (Varied Question Counts)
  { type: SurveyType.QUIZ, title: "تحدي ملوك الدولة السعودية", desc: "اختبر معرفتك بملوك المملكة العربية السعودية وإنجازاتهم.", qsCount: 3, cat: "تاريخ" },
  { type: SurveyType.QUIZ, title: "اختبار قواعد اللغة العربية", desc: "هل مازلت تذكر قواعد النحو والصرف؟", qsCount: 5, cat: "تعليم" },
  { type: SurveyType.QUIZ, title: "تحدي الدوري السعودي (روشن)", desc: "أسئلة للمشجعين الحقيقيين عن الأرقام والبطولات.", qsCount: 4, cat: "رياضة" },
  { type: SurveyType.QUIZ, title: "معالم الوطن العربي", desc: "هل تعرف في أي دولة تقع هذه المعالم الشهيرة؟", qsCount: 5, cat: "جغرافيا" },
  { type: SurveyType.QUIZ, title: "اختبار الثقافة الإسلامية", desc: "معلومات عامة عن السيرة النبوية والتاريخ الإسلامي.", qsCount: 3, cat: "دين" },
  
  // Surveys (Varied Section Counts)
  { type: SurveyType.SURVEY, title: "استبيان رضا الموظفين - رؤية 2030", desc: "دراسة حول مدى تماشي بيئة العمل مع التحول الوطني.", secCount: 2, cat: "أعمال" },
  { type: SurveyType.SURVEY, title: "تجربة التسوق الإلكتروني في المملكة", desc: "نهدف لجمع بيانات حول جودة الشحن والخدمات.", secCount: 3, cat: "تجارة" },
  { type: SurveyType.SURVEY, title: "عادات القراءة لدى الشباب العربي", desc: "بحث اجتماعي حول المحتوى المفضل ومنصات القراءة.", secCount: 2, cat: "ثقافة" }
];

const ENGLISH_TOPICS = [
  // Polls
  { type: SurveyType.POLL, title: "Best Game Engine for Indies?", opts: ["Unity", "Unreal Engine 5", "Godot", "GameMaker"], cat: "Technology" },
  { type: SurveyType.POLL, title: "Will Remote Work Survive 2025?", opts: ["Full Remote is the future", "Hybrid is the balance", "Back to office is inevitable"], cat: "Business" },
  { type: SurveyType.POLL, title: "Marvel vs DC: Current State", opts: ["Marvel is still king", "DC is rising", "Superhero fatigue is real"], cat: "Entertainment" },
  { type: SurveyType.POLL, title: "Preferred Cloud Platform?", opts: ["AWS", "Azure", "Google Cloud", "Vercel"], cat: "DevOps" },
  { type: SurveyType.POLL, title: "Best Programming Font?", opts: ["Fira Code", "JetBrains Mono", "Cascadia Code", "Operator Mono"], cat: "Technology" },
  
  // Quizzes
  { type: SurveyType.QUIZ, title: "JavaScript ES2024 Mastery", desc: "Test your knowledge of the latest JS features.", qsCount: 5, cat: "Programming" },
  { type: SurveyType.QUIZ, title: "The Space Race History", desc: "Key milestones in human space exploration.", qsCount: 4, cat: "Science" },
  { type: SurveyType.QUIZ, title: "World Capitals Challenge", desc: "Can you name the capitals of these 5 countries?", qsCount: 5, cat: "Geography" },
  { type: SurveyType.QUIZ, title: "Olympic Games Trivia", desc: "How much do you know about the history of the Olympics?", qsCount: 3, cat: "Sports" },
  { type: SurveyType.QUIZ, title: "Classic Rock Quiz", desc: "Identify bands from their iconic album covers.", qsCount: 4, cat: "Music" },
  
  // Surveys
  { type: SurveyType.SURVEY, title: "Mental Health in Tech Survey", desc: "A deep dive into burnout and work-life balance.", secCount: 3, cat: "Health" },
  { type: SurveyType.SURVEY, title: "AI Ethics Feedback", desc: "Public opinion on AI regulations and safety.", secCount: 2, cat: "Philosophy" },
  { type: SurveyType.SURVEY, title: "Fitness Habits 2024", desc: "Data collection on workout frequency and diet trends.", secCount: 3, cat: "Lifestyle" }
];

// --- 3. Generative Engine ---

const getRandomUser = () => MOCK_USERS[Math.floor(Math.random() * MOCK_USERS.length)];

const createBaseSurvey = (id: string, topic: any, lang: 'ar' | 'en'): Partial<Survey> => {
  const author = getRandomUser();
  const hoursAgo = Math.floor(Math.random() * 168) + 1;
  const createdAtDate = new Date(Date.now() - 1000 * 60 * 60 * hoursAgo);
  const expiresAtDate = new Date(Date.now() + 1000 * 60 * 60 * (Math.floor(Math.random() * 200) + 48));

  return {
    id,
    title: topic.title,
    description: topic.desc || (lang === 'ar' ? "استطلاع رأي واقعي ومفيد." : "A realistic and engaging survey topic."),
    category: topic.cat,
    type: topic.type,
    author: { name: author.name, avatar: author.avatar, type: author.type },
    createdAt: createdAtDate.toISOString(),
    expiresAt: expiresAtDate.toISOString(),
    likes: Math.floor(Math.random() * 4000),
    commentsCount: Math.floor(Math.random() * 400),
    isLiked: Math.random() > 0.8,
    isTrending: Math.random() > 0.9,
    participants: Math.floor(Math.random() * 25000) + 100,
    userProgress: { currentQuestionIndex: 0, answers: {} },
    resultsDetail: 'Detailed', // Force visibility for demo
    resultsWho: 'Public',      // Force visibility for demo
    resultsTiming: 'Immediately' // Force visibility for demo
  };
};

const genDynamicPoll = (id: string, topic: any, lang: 'ar' | 'en'): Survey => {
  const base = createBaseSurvey(id, topic, lang);
  const hasImages = Math.random() > 0.5;

  return {
    ...base,
    question: topic.title,
    coverImage: Math.random() > 0.6 ? `https://picsum.photos/800/400?random=${id}` : undefined,
    imageLayout: Math.random() > 0.5 ? 'horizontal' : 'vertical',
    options: topic.opts.map((t: string, i: number) => ({
      id: `opt-${id}-${i}`,
      text: t,
      votes: Math.floor(Math.random() * 5000),
      image: hasImages ? `https://picsum.photos/300/300?random=${id}${i}` : undefined
    })),
  } as Survey;
};

const genDynamicQuiz = (id: string, topic: any, lang: 'ar' | 'en'): Survey => {
  const base = createBaseSurvey(id, topic, lang);
  const qsCount = topic.qsCount || 3;
  
  const sections: SurveySection[] = [{
    id: `sec-${id}`,
    title: lang === 'ar' ? 'جولة الأسئلة' : 'Question Round',
    questions: Array.from({ length: qsCount }).map((_, qIdx) => ({
      id: `q-${id}-${qIdx}`,
      text: lang === 'ar' ? `السؤال رقم ${qIdx + 1} المتعلق بـ ${topic.cat}` : `Real question ${qIdx + 1} about ${topic.cat}`,
      type: 'multiple_choice',
      weight: 20,
      correctOptionId: `opt-${id}-${qIdx}-0`,
      image: Math.random() > 0.5 ? `https://picsum.photos/400/300?random=q${id}${qIdx}` : undefined,
      options: [
        { id: `opt-${id}-${qIdx}-0`, text: lang === 'ar' ? 'الإجابة الصحيحة الواقعية' : 'The realistic correct answer', votes: 0 },
        { id: `opt-${id}-${qIdx}-1`, text: lang === 'ar' ? 'خيار خاطئ منطقي' : 'A plausible wrong answer', votes: 0 },
        { id: `opt-${id}-${qIdx}-2`, text: lang === 'ar' ? 'احتمال آخر' : 'Another possibility', votes: 0 }
      ]
    }))
  }];

  return { ...base, sections, quizTimeLimit: qsCount * 2 } as Survey;
};

const genDynamicSurvey = (id: string, topic: any, lang: 'ar' | 'en'): Survey => {
  const base = createBaseSurvey(id, topic, lang);
  const secCount = topic.secCount || 2;
  
  const sections: SurveySection[] = Array.from({ length: secCount }).map((_, sIdx) => ({
    id: `sec-${id}-${sIdx}`,
    title: lang === 'ar' ? `القسم ${sIdx + 1}: ${topic.cat}` : `Section ${sIdx + 1}: ${topic.cat}`,
    questions: Array.from({ length: 2 }).map((_, qIdx) => ({
      id: `q-${id}-${sIdx}-${qIdx}`,
      text: lang === 'ar' ? `يرجى تقييم جانب من جوانب ${topic.title}` : `Please evaluate a specific aspect of ${topic.title}`,
      type: qIdx % 2 === 0 ? 'multiple_choice' : 'text',
      options: qIdx % 2 === 0 ? [
        { id: `o1-${id}-${sIdx}`, text: lang === 'ar' ? 'ممتاز' : 'Excellent', votes: 0 },
        { id: `o2-${id}-${sIdx}`, text: lang === 'ar' ? 'جيد جداً' : 'Very Good', votes: 0 },
        { id: `o3-${id}-${sIdx}`, text: lang === 'ar' ? 'يحتاج تحسين' : 'Needs improvement', votes: 0 }
      ] : undefined
    }))
  }));

  return { ...base, sections } as Survey;
};

// --- 4. Main Generation Loop (70 Unique Posts) ---

const generate70UniquePosts = (): Survey[] => {
  const posts: Survey[] = [];
  
  const getUniqueTopic = (list: any[]) => {
    const idx = Math.floor(Math.random() * list.length);
    return list.splice(idx, 1)[0];
  };

  const arList = [...ARABIC_TOPICS];
  const enList = [...ENGLISH_TOPICS];

  for (let i = 1; i <= 70; i++) {
    const isArabic = i <= 35;
    const currentList = isArabic ? arList : enList;
    const lang = isArabic ? 'ar' : 'en';
    
    const topic = currentList.length > 0 ? getUniqueTopic(currentList) : (isArabic ? ARABIC_TOPICS[i % 10] : ENGLISH_TOPICS[i % 10]);
    
    if (topic.type === SurveyType.POLL) posts.push(genDynamicPoll(i.toString(), topic, lang));
    else if (topic.type === SurveyType.QUIZ) posts.push(genDynamicQuiz(i.toString(), topic, lang));
    else posts.push(genDynamicSurvey(i.toString(), topic, lang));
  }

  return posts.sort(() => Math.random() - 0.5);
};

export const MOCK_SURVEYS: Survey[] = generate70UniquePosts();

// Fix: Adding exported MOCK_COMMENTS
export const MOCK_COMMENTS: Comment[] = [
  {
    id: 'c1',
    author: { name: 'ريم القحطاني', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop' },
    text: 'المحتوى جداً مميز والأسئلة ذكية!',
    timestamp: '2h ago',
    likes: 8,
    isLiked: false,
    replies: [
      {
        id: 'c1-r1',
        author: { name: 'أحمد الفارس', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop' },
        text: 'صدقتِ، دائماً استبياناتهم مفيدة.',
        timestamp: '1h ago',
        likes: 2,
        isLiked: false
      }
    ]
  },
  {
    id: 'c2',
    author: { name: 'Tech Insider', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop' },
    text: 'Really interesting to see how these results compare to previous years.',
    timestamp: '4h ago',
    likes: 14,
    isLiked: true
  }
];

// Fix: Adding exported MOCK_NOTIFICATIONS
export const MOCK_NOTIFICATIONS: Notification[] = [
  {
    id: 'n1',
    type: 'vote',
    actor: { name: 'نورة السعيد', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop' },
    message: 'voted on your poll about future tech.',
    timestamp: '10m ago',
    isRead: false,
    targetId: '1',
    targetType: 'survey'
  },
  {
    id: 'n2',
    type: 'response',
    actor: { name: 'ياسين علي', avatar: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=100&h=100&fit=crop' },
    message: 'responded to your survey about reading habits.',
    timestamp: '30m ago',
    isRead: false,
    targetId: '2',
    targetType: 'survey'
  },
  {
    id: 'n3',
    type: 'group_invite',
    actor: { name: 'خالد بن فيصل', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop' },
    message: 'invited you to join "Global Insight Hub"',
    timestamp: '2h ago',
    isRead: true,
    targetId: 'g1',
    targetType: 'group'
  }
];
