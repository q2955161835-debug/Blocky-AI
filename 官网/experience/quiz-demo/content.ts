export type QuizQuestion = { topic: string; question: string; options: string[]; answer: number; explanation: string; numerator: number; denominator: number };
export const questions: QuizQuestion[] = [
  { topic: '分数含义', question: '把一块巧克力平均分成 8 份，取其中 3 份。取出的部分是整块的几分之几？', options: ['3/8', '8/3', '3/5', '5/8'], answer: 0, explanation: '分母 8 表示平均分成 8 份，分子 3 表示取了 3 份，所以是 3/8。', numerator: 3, denominator: 8 },
  { topic: '同分母比较', question: '两根同样长的彩带，小雨用了 3/7，小林用了 5/7。谁用得更多？', options: ['小雨', '小林', '一样多', '无法比较'], answer: 1, explanation: '分母相同，每一份同样大。5 份比 3 份多，所以 5/7 > 3/7，小林用得更多。', numerator: 5, denominator: 7 },
  { topic: '分数加法', question: '上午看了一本书的 2/9，下午又看了 4/9。一天共看了这本书的几分之几？', options: ['2/9', '6/18', '6/9', '4/9'], answer: 2, explanation: '同分母分数相加，分母不变，分子相加：2/9 + 4/9 = 6/9。', numerator: 6, denominator: 9 },
  { topic: '分数减法', question: '一壶果汁原来有 7/10 壶，喝掉 2/10 壶，现在还剩多少壶？', options: ['9/10', '5/20', '2/10', '5/10'], answer: 3, explanation: '同分母分数相减，分母不变，分子相减：7/10 − 2/10 = 5/10。', numerator: 5, denominator: 10 },
  { topic: '整体与剩余', question: '一张完整的纸用去了 3/8，还剩下这张纸的几分之几？', options: ['3/8', '5/8', '5/5', '1/8'], answer: 1, explanation: '一张完整的纸是 8/8。用去 3/8，剩下 8/8 − 3/8 = 5/8。', numerator: 5, denominator: 8 },
];
export const quizPrompt = '从空白画布创建一个四年级分数出题助手。连接《分数入门》资料，依次出五道题，覆盖分数含义、比较、加法、减法与剩余。生成“今日练习”页面，题目逐题出现，点选后显示解析；页面与 Studio 都可以继续追问。';
export const generatePrompt = '生成今日五道分数练习，覆盖含义、比较、加减和剩余部分。';
export const explanationPrompt = '第 2 题为什么不用比较分母？';
export const explanationReply = '因为两根彩带一样长，而且都平均分成 7 份，每一份就同样大。只要比较用了几份：小林用了 5 份，小雨用了 3 份，所以小林更多。\n\n记住：同分母分数比较大小，分子越大，分数越大。';
export const followupPrompt = '可以用图解释最后一题吗？';
export const followupReply = '把整张纸看成 8 个同样大的小格：用去 3 格，留下 5 格。页面上的色块表示剩下的部分。\n\n整体：8/8\n用去：3/8\n剩下：5/8\n\n你也可以把“用去 3 格”改成“用去 2 格”，自己算一算。';
export const quizChapters = [
  { at: 0, label: '从零开始', detail: '一句需求，确定练习目标与页面。' },
  { at: 24, label: '连接资料', detail: '让出题有依据，五个知识点各出一题。' },
  { at: 48, label: '搭建积木', detail: '生成、校验、发布，再保留练习记忆。' },
  { at: 90, label: '生成练习', detail: '同一个 Agent 驱动题卡与页面聊天。' },
  { at: 142, label: '讲解与追问', detail: '点选答案看解析，两端接着同一段对话。' },
];
