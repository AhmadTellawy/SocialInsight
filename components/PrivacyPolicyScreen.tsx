import React from 'react';
import { ArrowLeft, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export const PrivacyPolicyScreen: React.FC = () => {
    const navigate = useNavigate();
    const { i18n } = useTranslation();
    const ar = i18n.language.startsWith('ar');
    const text = (english: string, arabic: string) => ar ? arabic : english;
    const sections = [
      {
        title: text('1. About this policy', '١. حول هذه السياسة'),
        paragraphs: [text('This policy describes how Opiniup uses account information, content, participation data and privacy controls. The audience you choose for content and the permissions of a group also affect who can access it.', 'توضح هذه السياسة كيفية استخدام Opiniup لمعلومات الحساب والمحتوى وبيانات المشاركة وأدوات الخصوصية. يؤثر جمهور المحتوى الذي تختاره وصلاحيات المجموعة أيضًا في من يستطيع الوصول إليه.')]
      },
      {
        title: text('2. Information we process', '٢. المعلومات التي نعالجها'),
        paragraphs: [
          text('Account information includes your name, username, email, sign-in methods and the profile information you provide, including photos, links and location. Optional demographic details include gender, marital status, education, employment and nationality. Your age group is calculated from your date of birth.', 'تشمل معلومات الحساب اسمك واسم المستخدم والبريد وطرق الدخول، وما تقدمه في ملفك من صور وروابط وموقع. وتشمل التفاصيل الديموغرافية الاختيارية الجنس والحالة الاجتماعية والتعليم والعمل والجنسية. تُحسب فئتك العمرية من تاريخ ميلادك.'),
          text('We process content and interactions such as posts, comments, answers, follows and group memberships. Technical and usage information may include IP addresses, session and browser information, time zone, notification subscriptions and interaction events used to operate and protect the service.', 'نعالج المحتوى والتفاعلات مثل المنشورات والتعليقات والإجابات والمتابعات وعضويات المجموعات. قد تشمل المعلومات التقنية وبيانات الاستخدام عناوين IP ومعلومات الجلسة والمتصفح والمنطقة الزمنية واشتراكات الإشعارات وأحداث التفاعل اللازمة لتشغيل الخدمة وحمايتها.'),
          text('If you use a connected sign-in provider, we receive the account identifier and the name or email details it supplies. If you enable authenticator verification, we store encrypted setup information and protected recovery-code records to verify access. Account downloads do not include passwords, verification secrets or recovery codes.', 'إذا استخدمت مزوّد دخول مرتبطًا، نتلقى معرّف الحساب وما يقدّمه المزوّد من اسم أو بيانات بريد. وإذا فعّلت التحقق عبر تطبيق مصادقة، نخزّن معلومات الإعداد مشفّرة وسجلات محمية لرموز الاسترداد للتحقق من الوصول. لا تتضمن تنزيلات الحساب كلمات المرور أو أسرار التحقق أو رموز الاسترداد.')
        ]
      },
      {
        title: text('3. How information is used', '٣. كيف تُستخدم المعلومات'),
        paragraphs: [text('We use information to register and manage accounts, provide the features you use, generate participation insights, deliver notifications according to your settings, maintain result integrity, investigate abuse and maintain and improve the application. Optional demographic details are not displayed on your public profile.', 'نستخدم المعلومات لإنشاء الحسابات وإدارتها، وتقديم الميزات التي تستخدمها، وإنتاج تحليلات المشاركة، وإرسال الإشعارات وفق إعداداتك، والحفاظ على سلامة النتائج، والتحقق من الإساءة، وصيانة التطبيق وتحسينه. لا تظهر التفاصيل الديموغرافية الاختيارية في ملفك العام.')]
      },
      {
        title: text('4. Results and anonymous participation', '٤. النتائج والمشاركة المجهولة'),
        paragraphs: [
          text('Result dashboards show aggregate summaries to viewers who meet the post’s access, audience and timing rules. Demographic breakdowns use group summaries and suppress small groups. These measures reduce identification risk; they are not a guarantee that a person can never be inferred from context.', 'تعرض لوحات النتائج ملخصات مجمّعة للمشاهدين الذين تنطبق عليهم قواعد الوصول والجمهور وتوقيت النتائج للمنشور. تستخدم التفاصيل الديموغرافية ملخصات للمجموعات مع حجب المجموعات الصغيرة. تقلل هذه التدابير خطر التعرف على الأشخاص، ولا تضمن استحالة استنتاج هوية شخص من السياق.'),
          text('Choosing anonymous participation hides your identity from the participation presentation; it does not erase the underlying account-linked response kept to protect voting and account integrity. Text you write may identify you or someone else. Consider what you include in comments and open-text answers.', 'اختيار المشاركة المجهولة يخفي هويتك عند عرض المشاركة، ولا يمحو الإجابة المرتبطة داخليًا بالحساب واللازمة لحماية سلامة التصويت والحساب. قد تكشف النصوص التي تكتبها هويتك أو هوية شخص آخر. انتبه لما تدرجه في التعليقات والإجابات النصية.')
        ]
      },
      {
        title: text('5. Privacy and notification controls', '٥. أدوات الخصوصية والإشعارات'),
        paragraphs: [
          text('Account settings let you control private-account access, discovery in people search, reposts within the platform, group invitations, people tags and the group memberships shown on your profile. Private groups retain their own access rules. Hiding your account from search does not remove a direct profile link or your identity on public content. Repost controls do not prevent copying a public link or taking a screenshot.', 'تتيح إعدادات الحساب التحكم في الوصول للحساب الخاص واكتشافه في البحث وإعادة النشر داخل المنصة ودعوات المجموعات ووسوم الأشخاص والعضويات الظاهرة في ملفك. تحتفظ المجموعات الخاصة بقواعد الوصول الخاصة بها. لا يزيل إخفاء الحساب من البحث رابط ملفه المباشر أو هويتك على المحتوى العام. ولا تمنع أدوات إعادة النشر نسخ رابط عام أو التقاط صورة للشاشة.'),
          text('Notification event preferences, the account-wide device delivery setting and this browser’s subscription are separate controls. Quiet hours pause device delivery while your in-app notification history remains available.', 'تفضيلات أحداث الإشعارات وإعداد إرسال إشعارات الأجهزة على مستوى الحساب واشتراك هذا المتصفح أدوات منفصلة. توقف ساعات الهدوء وصول إشعارات الأجهزة مع بقاء سجل الإشعارات داخل التطبيق متاحًا.')
        ]
      },
      {
        title: text('6. Managing, deactivating and deleting your account', '٦. إدارة الحساب وتعطيله وحذفه'),
        paragraphs: [
          text('You can correct editable profile details, clear optional demographic fields, download account information, manage active sessions and block accounts from Settings. Sensitive account actions require renewed identity verification.', 'يمكنك تصحيح بيانات الملف القابلة للتعديل ومسح الحقول الديموغرافية الاختيارية وتنزيل معلومات الحساب وإدارة الجلسات وحظر الحسابات من الإعدادات. تتطلب الإجراءات الحساسة إعادة التحقق من الهوية.'),
          text('Temporary deactivation hides your account and its posts and ends its sessions while keeping your data for reactivation. Signing in and confirming reactivation restores access. Copies of previously public content or cached media may remain outside the service.', 'يخفي التعطيل المؤقت حسابك ومنشوراته وينهي جلساته مع الاحتفاظ ببياناتك لإعادة التفعيل. تستعيد الوصول بتسجيل الدخول وتأكيد إعادة التفعيل. قد تبقى نسخ من المحتوى العام سابقًا أو الوسائط المخزنة مؤقتًا خارج الخدمة.'),
          text('Account deletion removes profile details, sign-in methods, demographic information and private account settings. Published contributions and survey answers may remain for conversation and result integrity, with the account displayed as deleted. This does not remove personal information you included in retained text. Moderation reports may also be retained. Media cleanup is processed separately and retried when needed; deletion does not promise immediate removal of every backup or external copy.', 'يزيل حذف الحساب بيانات الملف وطرق الدخول والمعلومات الديموغرافية وإعدادات الحساب الخاصة. قد تبقى المساهمات المنشورة وإجابات الاستبيانات للحفاظ على المحادثات وسلامة النتائج، ويظهر الحساب كمحذوف. لا يزيل ذلك المعلومات الشخصية التي كتبتها في النصوص المحتفظ بها. قد تُحفظ بلاغات الإشراف أيضًا. تجري إزالة الوسائط بصورة منفصلة مع إعادة المحاولة عند الحاجة؛ ولا يعني الحذف إزالة فورية لكل نسخة احتياطية أو نسخة خارجية.')
        ]
      },
      {
        title: text('7. Your rights', '٧. حقوقك'),
        paragraphs: [text('Depending on applicable data protection law and your circumstances, you may have rights to access, correct or erase personal information, object to processing or request restriction of processing. Account tools provide some of these controls directly; the scope of a legal request depends on the applicable law.', 'بحسب قانون حماية البيانات المنطبق وظروفك، قد تكون لك حقوق في الوصول إلى المعلومات الشخصية أو تصحيحها أو محوها أو الاعتراض على معالجتها أو طلب تقييد المعالجة. توفر أدوات الحساب بعض هذه الخيارات مباشرة، ويعتمد نطاق الطلب القانوني على القانون المنطبق.')]
      },
      {
        title: text('8. Cookies and browser storage', '٨. ملفات تعريف الارتباط وتخزين المتصفح'),
        paragraphs: [text('We use browser cookies to keep you signed in, protect account requests and complete sign-in verification. Browser storage also keeps preferences, a guest identifier and cached application data. When you participate as a guest, a cookie helps verify that this browser submitted a response. That cookie lasts for up to 30 days after a successful guest submission and can be renewed by another submission. Access proof for each response expires 30 days after that response was created. Clearing the cookie or letting the proof expire may prevent you from continuing that response or viewing participant-only results; it does not delete the answers already submitted. You can manage cookies and stored site data in your browser settings, which may also sign you out or reset local preferences.', 'نستخدم ملفات تعريف الارتباط في المتصفح لإبقائك مسجّل الدخول وحماية طلبات الحساب وإتمام التحقق عند الدخول. ويحتفظ المتصفح أيضًا بتفضيلات ومعرّف للضيف وبيانات مؤقتة للتطبيق. عند المشاركة كضيف، يساعد ملف تعريف ارتباط في التحقق من أن هذا المتصفح أرسل الإجابة. يبقى هذا الملف لمدة تصل إلى 30 يومًا بعد إرسال مشاركة ضيف بنجاح، وقد تتجدد المدة بإرسال مشاركة أخرى. تنتهي صلاحية إثبات الوصول لكل إجابة بعد 30 يومًا من إنشائها. قد يمنعك مسح الملف أو انتهاء صلاحية الإثبات من متابعة الإجابة أو عرض النتائج المتاحة للمشاركين فقط؛ ولا يحذف ذلك الإجابات المرسلة. يمكنك إدارة ملفات تعريف الارتباط وبيانات الموقع المخزنة من إعدادات المتصفح، وقد يؤدي ذلك أيضًا إلى تسجيل خروجك أو إعادة ضبط التفضيلات المحلية.')]
      },
      {
        title: text('9. Service providers', '٩. مزوّدو الخدمة'),
        paragraphs: [text('Providers that host the application, store its data and media, and deliver verification emails or device notifications process the information needed for those services.', 'يعالج المزوّدون الذين يستضيفون التطبيق ويخزّنون بياناته ووسائطه ويرسلون رسائل التحقق أو إشعارات الأجهزة المعلومات اللازمة لهذه الخدمات.')]
      }
    ];

    return (
        <div dir={i18n.dir()} className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300 z-50">
            <div className="bg-white border-b border-gray-100 flex items-center px-4 h-14 sticky top-0 z-30">
                <button type="button" onClick={() => typeof window.history.state?.idx === 'number' && window.history.state.idx > 0 ? navigate(-1) : navigate('/', { replace: true })} aria-label={text('Back', 'رجوع')} className="flex h-11 w-11 items-center justify-center -ms-2 text-gray-600 hover:bg-gray-50 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-blue-600">
                    <ArrowLeft size={24} className="rtl:rotate-180" />
                </button>
                <div className="flex items-center gap-2 ms-2 text-gray-900">
                    <Shield size={20} className="text-blue-600" />
                    <span className="font-bold text-lg">{text('Privacy Policy', 'سياسة الخصوصية')}</span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-10 no-scrollbar max-w-3xl mx-auto w-full">
                <div className="space-y-8 pb-20 text-gray-700 leading-relaxed text-sm">
                    <div className="text-center mb-10">
                        <h1 className="text-3xl font-black text-gray-900 mb-4">{text('Privacy Policy', 'سياسة الخصوصية')}</h1>
                        <p className="text-gray-600 font-medium">{text('Last updated: September 2026', 'آخر تحديث: سبتمبر ٢٠٢٦')}</p>
                    </div>

                    {sections.map((section) => <section key={section.title} className="space-y-4"><h2 className="text-xl font-bold text-gray-900">{section.title}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</section>)}
                    <section className="space-y-4 p-6 bg-blue-50 rounded-2xl border border-blue-100">
                        <h2 className="text-xl font-bold text-blue-900">{text('Contact us', 'تواصل معنا')}</h2>
                        <p className="text-blue-800">
                            {text('For questions about this policy or our privacy practices:', 'للاستفسارات عن هذه السياسة أو ممارسات الخصوصية:')}
                            <br /><br />
                            <strong>{text('Email:', 'البريد:')}</strong> <bdi>privacy@socialinsightapp.com</bdi><br />
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
};

