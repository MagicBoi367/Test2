import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SEED_EXAMS, SEED_QUESTIONS, SEED_SUBMISSIONS } from '../data/seedData';
import {
  derivePrivateClassCode,
  SEED_CLASS_ASSIGNMENTS,
  SEED_CLASS_JOIN_REQUESTS,
  SEED_CLASS_MATERIALS,
  SEED_CLASS_SCHEDULES,
  SEED_TEACHER_CLASSES,
} from '../data/studentPortalData';
import type {
  ClassAssignment,
  ClassJoinRequest,
  ClassMaterial,
  ClassScheduleSlot,
  Exam,
  ExamSubmission,
  Question,
  SystemConfig,
  TeacherPrivateClass,
  UserRole,
} from '../types/exam';
import {
  buildSeedRawAccountsForServer,
  getSeededRawAccountsForServer,
  listAccountsSync,
  migrateStoredAccountIdsSync,
  resetSeedAccounts,
  updateStoredAccount,
} from '../utils/authStore';
import {
  getRealtimeNow,
  registerSeedSnapshotProvider,
  sendRealtimeMutation,
  subscribeRealtimeMessages,
} from '../utils/realtimeClient';
import { formatGradeLabel, MAX_CLASSES_PER_TEACHER } from '../utils/scoring2025';
import { clearCustomSubjects, loadCustomSubjects } from '../utils/subjectStore';
import {
  appendSystemLog,
  readSystemLogs,
  resetSeedSystemLogs,
  SEED_SYSTEM_LOGS,
} from '../utils/systemLogs';
import {
  pushTeacherAlert,
  readTeacherAlerts,
  resetSeedTeacherAlerts,
  SEED_TEACHER_ALERTS,
} from '../utils/teacherAlerts';

const STORAGE_KEYS = {
  questions: 'kythi2025_questions_v1',
  exams: 'kythi2025_exams_v1',
  submissions: 'kythi2025_submissions_v1',
  privateClasses: 'kythi2025_private_classes_v1',
  classJoinRequests: 'kythi2025_class_join_requests_v1',
  classMaterials: 'kythi2025_class_materials_v1',
  classAssignments: 'kythi2025_class_assignments_v1',
  classSchedules: 'kythi2025_class_schedules_v1',
  role: 'kythi2025_role_v1',
  systemConfig: 'kythi2025_system_config_v1',
  gradeSeedMigrated: 'kythi2025_grade_seeds_v1',
  classHubSeedMigrated: 'kythi2025_class_hub_seed_v1',
  questionsOwnershipMigrated: 'kythi2025_questions_ownership_v2',
  examsOwnershipMigrated: 'kythi2025_exams_ownership_v2',
} as const;

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  allowSelfRegistration: true,
  allowGuestPreview: true,
  announcementEnabled: false,
  announcementText:
    'Kỳ thi thử Tốt nghiệp THPT 2025 đang mở phòng thi trực tuyến. Thí sinh vui lòng kiểm tra SBD trước khi vào phòng.',
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeExam(exam: Exam): Exam {
  const effectiveDuration = Math.max(1, exam.duration ?? exam.durationMinutes ?? 45);
  return {
    ...exam,
    duration: effectiveDuration,
    durationMinutes: effectiveDuration,
    autoSubmitOnTimeout: exam.autoSubmitOnTimeout ?? true,
    warningMinutes: exam.warningMinutes ?? 5,
  };
}

function loadInitialQuestions(): Question[] {
  migrateStoredAccountIdsSync();
  let next = readStorage<Question[]>(STORAGE_KEYS.questions, SEED_QUESTIONS);
  try {
    if (!localStorage.getItem(STORAGE_KEYS.gradeSeedMigrated)) {
      const existingIds = new Set(next.map((q) => q.id));
      const missing = SEED_QUESTIONS.filter((q) => !existingIds.has(q.id));
      if (missing.length > 0) next = [...next, ...missing];
    }
    if (!localStorage.getItem(STORAGE_KEYS.questionsOwnershipMigrated)) {
      const seedQMap = new Map(SEED_QUESTIONS.map((q) => [q.id, q]));
      next = next.map((q) => {
        const seedMatch = seedQMap.get(q.id);
        return {
          ...q,
          isPrivate: q.isPrivate ?? seedMatch?.isPrivate ?? true,
          ownerTeacherId:
            q.ownerTeacherId ??
            seedMatch?.ownerTeacherId ??
            (q.subject === 'vat_li' ? 'GV0003' : 'GV0001'),
          ownerTeacherName:
            q.ownerTeacherName ??
            seedMatch?.ownerTeacherName ??
            (q.subject === 'vat_li' ? 'Cô Lê Thu Hà' : 'ThS. Trần Quốc Bảo'),
        };
      });
      localStorage.setItem(STORAGE_KEYS.questionsOwnershipMigrated, 'true');
    }
  } catch {
    // Ignore storage flag read/write errors
  }
  return next;
}

function loadInitialExams(): Exam[] {
  migrateStoredAccountIdsSync();
  const stored = readStorage<Exam[]>(STORAGE_KEYS.exams, SEED_EXAMS).map(normalizeExam);
  let next = stored;
  try {
    if (!localStorage.getItem(STORAGE_KEYS.gradeSeedMigrated)) {
      const existingIds = new Set(next.map((e) => e.id));
      const missing = SEED_EXAMS.filter((e) => !existingIds.has(e.id)).map(normalizeExam);
      localStorage.setItem(STORAGE_KEYS.gradeSeedMigrated, 'true');
      if (missing.length > 0) next = [...next, ...missing];
    }
    if (!localStorage.getItem(STORAGE_KEYS.classHubSeedMigrated)) {
      next = next.map((ex) => {
        if (ex.id === 'exam_toan_2025' && !ex.privateClassId && !ex.isPrivate) {
          return {
            ...ex,
            privateClassId: 'pclass_seed_toan12',
            ownerTeacherId: ex.ownerTeacherId ?? 'GV0001',
            ownerTeacherName: ex.ownerTeacherName ?? 'ThS. Trần Quốc Bảo',
          };
        }
        if (ex.id === 'exam_vatli_2025' && !ex.privateClassId && !ex.isPrivate) {
          return {
            ...ex,
            privateClassId: 'pclass_seed_vatli12',
            ownerTeacherId: ex.ownerTeacherId ?? 'GV0003',
            ownerTeacherName: ex.ownerTeacherName ?? 'Cô Lê Thu Hà',
          };
        }
        return ex;
      });
    }
    if (!localStorage.getItem(STORAGE_KEYS.examsOwnershipMigrated)) {
      const seedExMap = new Map(SEED_EXAMS.map((e) => [e.id, e]));
      next = next.map((ex) => {
        const seedMatch = seedExMap.get(ex.id);
        return {
          ...ex,
          ownerTeacherId:
            ex.ownerTeacherId ??
            seedMatch?.ownerTeacherId ??
            (ex.subject === 'vat_li' ? 'GV0003' : 'GV0001'),
          ownerTeacherName:
            ex.ownerTeacherName ??
            seedMatch?.ownerTeacherName ??
            (ex.subject === 'vat_li' ? 'Cô Lê Thu Hà' : 'ThS. Trần Quốc Bảo'),
        };
      });
      localStorage.setItem(STORAGE_KEYS.examsOwnershipMigrated, 'true');
    }
  } catch {
    // Ignore storage flag write errors
  }
  return next;
}

function loadInitialPrivateClasses(): TeacherPrivateClass[] {
  const stored = readStorage<TeacherPrivateClass[]>(
    STORAGE_KEYS.privateClasses,
    SEED_TEACHER_CLASSES,
  );
  try {
    if (!localStorage.getItem(STORAGE_KEYS.classHubSeedMigrated)) {
      const existingIds = new Set(stored.map((c) => c.id));
      const missing = SEED_TEACHER_CLASSES.filter((c) => !existingIds.has(c.id));
      localStorage.setItem(STORAGE_KEYS.classHubSeedMigrated, 'true');
      return missing.length > 0 ? [...stored, ...missing] : stored;
    }
  } catch {
    // Ignore storage errors
  }
  return stored;
}

export function useExamStore() {
  const [questions, setQuestions] = useState<Question[]>(() => loadInitialQuestions());
  const [exams, setExams] = useState<Exam[]>(() => loadInitialExams());
  const [submissions, setSubmissions] = useState<ExamSubmission[]>(() =>
    readStorage(STORAGE_KEYS.submissions, SEED_SUBMISSIONS),
  );
  const [privateClasses, setPrivateClasses] = useState<TeacherPrivateClass[]>(() =>
    loadInitialPrivateClasses(),
  );
  const [classJoinRequests, setClassJoinRequests] = useState<ClassJoinRequest[]>(() =>
    readStorage<ClassJoinRequest[]>(STORAGE_KEYS.classJoinRequests, SEED_CLASS_JOIN_REQUESTS),
  );
  const [classMaterials, setClassMaterials] = useState<ClassMaterial[]>(() =>
    readStorage<ClassMaterial[]>(STORAGE_KEYS.classMaterials, SEED_CLASS_MATERIALS),
  );
  const [classAssignments, setClassAssignments] = useState<ClassAssignment[]>(() =>
    readStorage<ClassAssignment[]>(STORAGE_KEYS.classAssignments, SEED_CLASS_ASSIGNMENTS),
  );
  const [classSchedules, setClassSchedules] = useState<ClassScheduleSlot[]>(() =>
    readStorage<ClassScheduleSlot[]>(STORAGE_KEYS.classSchedules, SEED_CLASS_SCHEDULES),
  );
  const [role, setRole] = useState<UserRole>(() =>
    readStorage<UserRole>(STORAGE_KEYS.role, 'student'),
  );
  const [systemConfig, setSystemConfig] = useState<SystemConfig>(() => ({
    ...DEFAULT_SYSTEM_CONFIG,
    ...readStorage<Partial<SystemConfig>>(STORAGE_KEYS.systemConfig, {}),
  }));

  const stateRef = useRef({
    questions,
    exams,
    submissions,
    privateClasses,
    classJoinRequests,
    classMaterials,
    classAssignments,
    classSchedules,
    systemConfig,
  });

  useEffect(() => {
    stateRef.current = {
      questions,
      exams,
      submissions,
      privateClasses,
      classJoinRequests,
      classMaterials,
      classAssignments,
      classSchedules,
      systemConfig,
    };
  }, [
    questions,
    exams,
    submissions,
    privateClasses,
    classJoinRequests,
    classMaterials,
    classAssignments,
    classSchedules,
    systemConfig,
  ]);

  useEffect(() => {
    registerSeedSnapshotProvider(async () => {
      const snap = stateRef.current;
      const seededAccounts = await getSeededRawAccountsForServer();
      return {
        questions: snap.questions,
        exams: snap.exams,
        submissions: snap.submissions,
        privateClasses: snap.privateClasses,
        classJoinRequests: snap.classJoinRequests,
        classMaterials: snap.classMaterials,
        classAssignments: snap.classAssignments,
        classSchedules: snap.classSchedules,
        systemConfig: snap.systemConfig,
        accounts: seededAccounts,
        customSubjects: loadCustomSubjects(),
        teacherAlerts: readTeacherAlerts(),
        systemLogs: readSystemLogs(),
      };
    });

    const applySliceUpdate = (slice: string, value: unknown) => {
      switch (slice) {
        case 'questions':
          if (Array.isArray(value)) setQuestions(value as Question[]);
          break;
        case 'exams':
          if (Array.isArray(value)) setExams((value as Exam[]).map(normalizeExam));
          break;
        case 'submissions':
          if (Array.isArray(value)) setSubmissions(value as ExamSubmission[]);
          break;
        case 'privateClasses':
          if (Array.isArray(value)) setPrivateClasses(value as TeacherPrivateClass[]);
          break;
        case 'classJoinRequests':
          if (Array.isArray(value)) setClassJoinRequests(value as ClassJoinRequest[]);
          break;
        case 'classMaterials':
          if (Array.isArray(value)) setClassMaterials(value as ClassMaterial[]);
          break;
        case 'classAssignments':
          if (Array.isArray(value)) setClassAssignments(value as ClassAssignment[]);
          break;
        case 'classSchedules':
          if (Array.isArray(value)) setClassSchedules(value as ClassScheduleSlot[]);
          break;
        case 'systemConfig':
          if (value && typeof value === 'object') {
            setSystemConfig({
              ...DEFAULT_SYSTEM_CONFIG,
              ...(value as Partial<SystemConfig>),
            });
          }
          break;
      }
    };

    const upsertList = <T extends { id: string }>(
      prev: T[],
      item: T,
      prepend = true,
    ): T[] => {
      const idx = prev.findIndex((x) => x.id === item.id);
      if (idx >= 0) {
        return prev.map((x) => (x.id === item.id ? item : x));
      }
      return prepend ? [item, ...prev] : [...prev, item];
    };

    return subscribeRealtimeMessages((msg) => {
      if (msg.type === 'snapshot') {
        for (const [k, v] of Object.entries(msg.data)) {
          applySliceUpdate(k, v);
        }
      } else if (msg.type === 'slice:updated') {
        applySliceUpdate(msg.slice, msg.value);
      } else if (msg.type === 'batch:updated') {
        for (const [k, v] of Object.entries(msg.patches)) {
          applySliceUpdate(k, v);
        }
      } else if (msg.type === 'item:upserted') {
        const prepend = msg.prepend !== false;
        switch (msg.slice) {
          case 'questions':
            setQuestions((prev) => upsertList(prev, msg.item as unknown as Question, prepend));
            break;
          case 'exams':
            setExams((prev) =>
              upsertList(prev, normalizeExam(msg.item as unknown as Exam), prepend),
            );
            break;
          case 'submissions':
            setSubmissions((prev) =>
              upsertList(prev, msg.item as unknown as ExamSubmission, prepend),
            );
            break;
          case 'privateClasses':
            setPrivateClasses((prev) =>
              upsertList(prev, msg.item as unknown as TeacherPrivateClass, prepend),
            );
            break;
          case 'classJoinRequests':
            setClassJoinRequests((prev) =>
              upsertList(prev, msg.item as unknown as ClassJoinRequest, prepend),
            );
            break;
          case 'classMaterials':
            setClassMaterials((prev) =>
              upsertList(prev, msg.item as unknown as ClassMaterial, prepend),
            );
            break;
          case 'classAssignments':
            setClassAssignments((prev) =>
              upsertList(prev, msg.item as unknown as ClassAssignment, prepend),
            );
            break;
          case 'classSchedules':
            setClassSchedules((prev) =>
              upsertList(prev, msg.item as unknown as ClassScheduleSlot, prepend),
            );
            break;
        }
      } else if (msg.type === 'item:removed') {
        switch (msg.slice) {
          case 'questions':
            setQuestions((prev) => prev.filter((x) => x.id !== msg.id));
            break;
          case 'exams':
            setExams((prev) => prev.filter((x) => x.id !== msg.id));
            break;
          case 'submissions':
            setSubmissions((prev) => prev.filter((x) => x.id !== msg.id));
            break;
          case 'privateClasses':
            setPrivateClasses((prev) => prev.filter((x) => x.id !== msg.id));
            break;
          case 'classJoinRequests':
            setClassJoinRequests((prev) => prev.filter((x) => x.id !== msg.id));
            break;
          case 'classMaterials':
            setClassMaterials((prev) => prev.filter((x) => x.id !== msg.id));
            break;
          case 'classAssignments':
            setClassAssignments((prev) => prev.filter((x) => x.id !== msg.id));
            break;
          case 'classSchedules':
            setClassSchedules((prev) => prev.filter((x) => x.id !== msg.id));
            break;
        }
      }
    });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.questions, JSON.stringify(questions));
    } catch {
      // Ignore storage quota errors
    }
  }, [questions]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.exams, JSON.stringify(exams));
    } catch {
      // Ignore storage quota errors
    }
  }, [exams]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.submissions, JSON.stringify(submissions));
    } catch {
      // Ignore storage quota errors
    }
  }, [submissions]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.role, JSON.stringify(role));
    } catch {
      // Ignore storage quota errors
    }
  }, [role]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.systemConfig, JSON.stringify(systemConfig));
    } catch {
      // Ignore storage quota errors
    }
  }, [systemConfig]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.privateClasses, JSON.stringify(privateClasses));
    } catch {
      // Ignore storage quota errors
    }
  }, [privateClasses]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.classJoinRequests,
        JSON.stringify(classJoinRequests),
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [classJoinRequests]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEYS.classJoinRequests || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue);
        if (Array.isArray(parsed)) {
          setClassJoinRequests(parsed as ClassJoinRequest[]);
        }
      } catch {
        // Ignore parse errors
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.classMaterials, JSON.stringify(classMaterials));
    } catch {
      // Ignore storage quota errors
    }
  }, [classMaterials]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.classAssignments, JSON.stringify(classAssignments));
    } catch {
      // Ignore storage quota errors
    }
  }, [classAssignments]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.classSchedules, JSON.stringify(classSchedules));
    } catch {
      // Ignore storage quota errors
    }
  }, [classSchedules]);

  const questionMap = useMemo(
    () => new Map(questions.map((q) => [q.id, q])),
    [questions],
  );

  const addQuestion = useCallback((q: Question) => {
    setQuestions((prev) => [q, ...prev]);
    sendRealtimeMutation({
      type: 'item:upsert',
      slice: 'questions',
      item: q,
      prepend: true,
    });
    appendSystemLog({
      category: 'question',
      level: 'info',
      action: 'Thêm câu hỏi mới',
      detail: `Thêm câu hỏi ${q.type} (${formatGradeLabel(q.grade)} · Môn ${q.subject}) vào ngân hàng.`,
      targetLabel: q.topic || q.id,
    });
  }, []);

  const updateQuestion = useCallback((updated: Question) => {
    setQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
    sendRealtimeMutation({
      type: 'item:upsert',
      slice: 'questions',
      item: updated,
    });
    appendSystemLog({
      category: 'question',
      level: 'info',
      action: 'Cập nhật câu hỏi',
      detail: `Chỉnh sửa câu hỏi ${updated.id} (${formatGradeLabel(updated.grade)} · Môn ${updated.subject}).`,
      targetLabel: updated.topic || updated.id,
    });
  }, []);

  const deleteQuestion = useCallback((id: string) => {
    const nextQuestions = stateRef.current.questions.filter((q) => q.id !== id);
    const nextExams = stateRef.current.exams.map((ex) => ({
      ...ex,
      part1QuestionIds: ex.part1QuestionIds.filter((qid) => qid !== id),
      part2QuestionIds: ex.part2QuestionIds.filter((qid) => qid !== id),
      part3QuestionIds: ex.part3QuestionIds.filter((qid) => qid !== id),
    }));
    setQuestions(nextQuestions);
    setExams(nextExams);
    sendRealtimeMutation({
      type: 'batch:set',
      patches: {
        questions: nextQuestions,
        exams: nextExams,
      },
    });
    appendSystemLog({
      category: 'question',
      level: 'warning',
      action: 'Xóa câu hỏi',
      detail: `Đã xóa câu hỏi ${id} khỏi ngân hàng câu hỏi.`,
      targetLabel: id,
    });
  }, []);

  const deleteAllQuestions = useCallback((questionIdsToDelete?: string[]) => {
    if (!questionIdsToDelete) {
      const nextExams = stateRef.current.exams.map((ex) => ({
        ...ex,
        part1QuestionIds: [],
        part2QuestionIds: [],
        part3QuestionIds: [],
      }));
      setQuestions([]);
      setExams(nextExams);
      sendRealtimeMutation({
        type: 'batch:set',
        patches: {
          questions: [],
          exams: nextExams,
        },
      });
      appendSystemLog({
        category: 'question',
        level: 'warning',
        action: 'Xóa toàn bộ ngân hàng câu hỏi',
        detail: 'Đã xóa toàn bộ câu hỏi trong ngân hàng và gỡ liên kết khỏi các đề thi.',
        targetLabel: 'Question Bank',
      });
      return;
    }
    const removeSet = new Set(questionIdsToDelete);
    const nextQuestions = stateRef.current.questions.filter((q) => !removeSet.has(q.id));
    const nextExams = stateRef.current.exams.map((ex) => ({
      ...ex,
      part1QuestionIds: ex.part1QuestionIds.filter((qid) => !removeSet.has(qid)),
      part2QuestionIds: ex.part2QuestionIds.filter((qid) => !removeSet.has(qid)),
      part3QuestionIds: ex.part3QuestionIds.filter((qid) => !removeSet.has(qid)),
    }));
    setQuestions(nextQuestions);
    setExams(nextExams);
    sendRealtimeMutation({
      type: 'batch:set',
      patches: {
        questions: nextQuestions,
        exams: nextExams,
      },
    });
    appendSystemLog({
      category: 'question',
      level: 'warning',
      action: 'Xóa hàng loạt câu hỏi',
      detail: `Đã xóa ${questionIdsToDelete.length} câu hỏi khỏi ngân hàng.`,
      targetLabel: `${questionIdsToDelete.length} câu hỏi`,
    });
  }, []);

  const importQuestions = useCallback((incoming: Question[]) => {
    const existingIds = new Set(stateRef.current.questions.map((q) => q.id));
    const fresh = incoming.filter((q) => !existingIds.has(q.id));
    const nextQuestions = [...fresh, ...stateRef.current.questions];
    setQuestions(nextQuestions);
    sendRealtimeMutation({
      type: 'slice:set',
      slice: 'questions',
      value: nextQuestions,
    });
    appendSystemLog({
      category: 'question',
      level: 'info',
      action: 'Nhập câu hỏi từ file',
      detail: `Đã nhập ${incoming.length} câu hỏi vào Ngân hàng câu hỏi.`,
      targetLabel: `${incoming.length} câu hỏi`,
    });
  }, []);

  const addExam = useCallback((exam: Exam) => {
    const normalized = normalizeExam(exam);
    setExams((prev) => [normalized, ...prev]);
    sendRealtimeMutation({
      type: 'item:upsert',
      slice: 'exams',
      item: normalized,
      prepend: true,
    });
    appendSystemLog({
      category: 'exam',
      level: 'info',
      action: 'Tạo đề thi mới',
      detail: `Tạo đề "${exam.title}" (Mã phòng ${exam.roomCode} · ${formatGradeLabel(exam.grade)}).`,
      targetLabel: exam.roomCode,
    });
  }, []);

  const updateExam = useCallback((updated: Exam) => {
    const normalized = normalizeExam(updated);
    setExams((prev) => prev.map((e) => (e.id === normalized.id ? normalized : e)));
    sendRealtimeMutation({
      type: 'item:upsert',
      slice: 'exams',
      item: normalized,
    });
    appendSystemLog({
      category: 'exam',
      level: 'info',
      action: 'Cập nhật đề thi / trạng thái phòng thi',
      detail: `Cập nhật đề "${updated.title}" (Mã phòng ${updated.roomCode} · Trạng thái: ${updated.status}).`,
      targetLabel: updated.roomCode,
    });
  }, []);

  const deleteExam = useCallback((id: string) => {
    setExams((prev) => prev.filter((e) => e.id !== id));
    sendRealtimeMutation({
      type: 'item:remove',
      slice: 'exams',
      id,
    });
    appendSystemLog({
      category: 'exam',
      level: 'warning',
      action: 'Xóa đề thi',
      detail: `Đã xóa đề thi ${id} khỏi hệ thống.`,
      targetLabel: id,
    });
  }, []);

  const deleteAllExams = useCallback((examIdsToDelete?: string[]) => {
    if (!examIdsToDelete) {
      setExams([]);
      sendRealtimeMutation({
        type: 'slice:set',
        slice: 'exams',
        value: [],
      });
      appendSystemLog({
        category: 'exam',
        level: 'warning',
        action: 'Xóa toàn bộ đề thi',
        detail: 'Đã xóa toàn bộ danh sách đề thi trong hệ thống.',
        targetLabel: 'All Exams',
      });
      return;
    }
    const removeSet = new Set(examIdsToDelete);
    const nextExams = stateRef.current.exams.filter((e) => !removeSet.has(e.id));
    setExams(nextExams);
    sendRealtimeMutation({
      type: 'slice:set',
      slice: 'exams',
      value: nextExams,
    });
    appendSystemLog({
      category: 'exam',
      level: 'warning',
      action: 'Xóa hàng loạt đề thi',
      detail: `Đã xóa ${examIdsToDelete.length} đề thi khỏi danh sách quản trị.`,
      targetLabel: `${examIdsToDelete.length} đề thi`,
    });
  }, []);

  const addSubmission = useCallback((sub: ExamSubmission) => {
    setSubmissions((prev) => [sub, ...prev]);
    sendRealtimeMutation({
      type: 'item:upsert',
      slice: 'submissions',
      item: sub,
      prepend: true,
    });
    appendSystemLog({
      category: 'exam',
      level: 'info',
      action: 'Nộp bài thi trực tuyến',
      detail: `${sub.studentName} (${sub.studentSbd} · ${sub.studentClass}) nộp đề "${sub.examTitle}" — Điểm: ${sub.totalScore.toFixed(2)}.`,
      actorName: sub.studentName,
      actorRole: 'student',
      actorId: sub.submittedByUserId,
      targetLabel: `${sub.roomCode} · Mã đề ${sub.variantCode}`,
    });
  }, []);

  const deleteSubmission = useCallback((id: string) => {
    setSubmissions((prev) => prev.filter((s) => s.id !== id));
    sendRealtimeMutation({
      type: 'item:remove',
      slice: 'submissions',
      id,
    });
    appendSystemLog({
      category: 'exam',
      level: 'warning',
      action: 'Xóa lịch sử bài nộp',
      detail: `Quản trị viên đã xóa bản ghi bài nộp ${id}.`,
      targetLabel: id,
    });
  }, []);

  const addPrivateClass = useCallback(
    (cls: TeacherPrivateClass): { ok: boolean; error?: string } => {
      const ownerId = cls.ownerTeacherId?.trim();
      const currentClasses = stateRef.current.privateClasses;
      const existingOwnedCount = ownerId
        ? currentClasses.filter((c) => c.ownerTeacherId === ownerId).length
        : 0;
      if (ownerId && existingOwnedCount >= MAX_CLASSES_PER_TEACHER) {
        appendSystemLog({
          category: 'class',
          level: 'warning',
          action: 'Vượt giới hạn tạo lớp học',
          detail: `Giáo viên ${cls.ownerTeacherName ?? ownerId} đã đạt giới hạn tối đa ${MAX_CLASSES_PER_TEACHER} lớp học.`,
          actorName: cls.ownerTeacherName,
          actorId: ownerId,
          targetLabel: cls.classCode || cls.name,
        });
        return {
          ok: false,
          error: `Mỗi tài khoản giáo viên chỉ được tạo tối đa ${MAX_CLASSES_PER_TEACHER} lớp học.`,
        };
      }

      setPrivateClasses((prev) => {
        if (
          ownerId &&
          prev.filter((c) => c.ownerTeacherId === ownerId).length >=
            MAX_CLASSES_PER_TEACHER
        ) {
          return prev;
        }
        return [cls, ...prev];
      });
      sendRealtimeMutation({
        type: 'item:upsert',
        slice: 'privateClasses',
        item: cls,
        prepend: true,
      });
      appendSystemLog({
        category: 'class',
        level: 'info',
        action: 'Tạo lớp học mới',
        detail: `Tạo lớp "${cls.name}" (${formatGradeLabel(cls.grade)}${cls.classCode ? ` · Mã ${cls.classCode}` : ''}).`,
        actorName: cls.ownerTeacherName,
        actorId: ownerId,
        targetLabel: cls.classCode || cls.name,
      });
      return { ok: true };
    },
    [],
  );

  const updatePrivateClass = useCallback((updated: TeacherPrivateClass) => {
    const nextClasses = stateRef.current.privateClasses.map((c) =>
      c.id === updated.id ? updated : c,
    );
    setPrivateClasses(nextClasses);
    const nextCode = updated.classCode?.trim().toUpperCase();
    if (nextCode) {
      const nextRequests = stateRef.current.classJoinRequests.map((req) =>
        req.classId === updated.id && req.classCode !== nextCode
          ? { ...req, classCode: nextCode }
          : req,
      );
      setClassJoinRequests(nextRequests);
      sendRealtimeMutation({
        type: 'batch:set',
        patches: {
          privateClasses: nextClasses,
          classJoinRequests: nextRequests,
        },
      });
    } else {
      sendRealtimeMutation({
        type: 'item:upsert',
        slice: 'privateClasses',
        item: updated,
      });
    }
    appendSystemLog({
      category: 'class',
      level: 'info',
      action: 'Cập nhật thông tin lớp học',
      detail: `Cập nhật lớp "${updated.name}" (${formatGradeLabel(updated.grade)}).`,
      targetLabel: updated.classCode || updated.name,
    });
  }, []);

  const deletePrivateClass = useCallback((id: string) => {
    const snap = stateRef.current;
    const nextClasses = snap.privateClasses.filter((c) => c.id !== id);
    const nextRequests = snap.classJoinRequests.filter((r) => r.classId !== id);
    const nextMaterials = snap.classMaterials.filter((m) => m.classId !== id);
    const nextAssignments = snap.classAssignments.filter((a) => a.classId !== id);
    const nextSchedules = snap.classSchedules.filter((s) => s.classId !== id);
    const nextExams = snap.exams.map((ex) =>
      ex.privateClassId === id
        ? {
            ...ex,
            privateClassId: undefined,
            isPrivate: true,
          }
        : ex,
    );

    setPrivateClasses(nextClasses);
    setClassJoinRequests(nextRequests);
    setClassMaterials(nextMaterials);
    setClassAssignments(nextAssignments);
    setClassSchedules(nextSchedules);
    setExams(nextExams);

    sendRealtimeMutation({
      type: 'batch:set',
      patches: {
        privateClasses: nextClasses,
        classJoinRequests: nextRequests,
        classMaterials: nextMaterials,
        classAssignments: nextAssignments,
        classSchedules: nextSchedules,
        exams: nextExams,
      },
    });
    appendSystemLog({
      category: 'class',
      level: 'warning',
      action: 'Xóa lớp học',
      detail: `Đã xóa lớp học ${id} cùng danh sách duyệt lớp, tài liệu, bài tập và lịch học liên quan.`,
      targetLabel: id,
    });
  }, []);

  const requestJoinClass = useCallback(
    (input: {
      targetClass: TeacherPrivateClass;
      studentUserId: string;
      studentName: string;
      studentSbd?: string;
      studentClass?: string;
      studentEmail?: string;
      actorRole?: UserRole | 'guest';
    }): { ok: true; request: ClassJoinRequest } | { ok: false; error: string } => {
      const code = derivePrivateClassCode(input.targetClass);
      const currentRequests = stateRef.current.classJoinRequests;
      const existing = currentRequests.find(
        (r) =>
          r.classId === input.targetClass.id &&
          r.studentUserId === input.studentUserId,
      );
      if (existing?.status === 'approved') {
        return { ok: false, error: `Bạn đã tham gia lớp "${input.targetClass.name}" rồi.` };
      }
      if (existing?.status === 'pending') {
        return {
          ok: false,
          error: `Yêu cầu vào lớp "${input.targetClass.name}" (${code}) đang chờ giáo viên duyệt.`,
        };
      }

      const requiresApproval = input.targetClass.requireApproval !== false;
      const nowMs = getRealtimeNow();
      const nowIso = new Date(nowMs).toISOString();
      const nextRequest: ClassJoinRequest = {
        id: existing?.id ?? `cjr_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
        classId: input.targetClass.id,
        classCode: code,
        studentUserId: input.studentUserId,
        studentName: input.studentName,
        studentSbd: input.studentSbd,
        studentClass: input.studentClass,
        studentEmail: input.studentEmail,
        status: requiresApproval ? 'pending' : 'approved',
        requestedAt: nowIso,
        reviewedAt: requiresApproval ? undefined : nowIso,
        reviewedByTeacherName: requiresApproval
          ? undefined
          : 'Tự động vào lớp (Tắt phê duyệt)',
      };

      setClassJoinRequests((prev) => {
        const filtered = prev.filter((r) => r.id !== nextRequest.id);
        return [nextRequest, ...filtered];
      });
      sendRealtimeMutation({
        type: 'item:upsert',
        slice: 'classJoinRequests',
        item: nextRequest,
        prepend: true,
      });

      if (!requiresApproval && input.studentUserId !== 'guest_student') {
        const stuAcc = listAccountsSync().find((a) => a.id === input.studentUserId);
        if (stuAcc) {
          const currentIds = new Set(stuAcc.enrolledClassIds ?? []);
          currentIds.add(input.targetClass.id);
          updateStoredAccount(stuAcc.id, {
            enrolledClassIds: Array.from(currentIds),
          });
        }
      }

      appendSystemLog({
        category: 'class',
        level: 'info',
        action: requiresApproval
          ? 'Xin vào lớp bằng mã lớp'
          : 'Tự động vào lớp bằng mã lớp',
        detail: requiresApproval
          ? `${input.studentName} gửi yêu cầu vào lớp "${input.targetClass.name}" (${code}), chờ giáo viên duyệt.`
          : `${input.studentName} tự động tham gia lớp "${input.targetClass.name}" (${code}) do lớp đang tắt phê duyệt.`,
        actorName: input.studentName,
        actorRole: input.actorRole ?? 'student',
        actorId: input.studentUserId === 'guest_student' ? undefined : input.studentUserId,
        targetLabel: code,
      });

      pushTeacherAlert({
        studentName: input.studentName,
        studentSbd: input.studentSbd || '—',
        studentClass: input.studentClass || '—',
        examId: input.targetClass.id,
        examTitle: input.targetClass.name,
        roomCode: code,
        variantCode: 'LỚP HỌC',
        actionType: requiresApproval ? 'class_join_request' : 'class_joined',
        title: requiresApproval
          ? 'Yêu cầu xin vào lớp học'
          : 'Học sinh đã tham gia lớp học',
        detail: requiresApproval
          ? `${input.studentName} đã nhập mã ${code} xin vào lớp "${input.targetClass.name}" và đang chờ bạn duyệt.`
          : `${input.studentName} đã tham gia lớp "${input.targetClass.name}" (${code}).`,
        severity: requiresApproval ? 'warning' : 'info',
        alertCategory: 'class_join',
        classId: input.targetClass.id,
        className: input.targetClass.name,
        classCode: code,
        joinRequestId: nextRequest.id,
        requiresApproval,
      });

      return { ok: true, request: nextRequest };
    },
    [],
  );

  const cancelJoinRequest = useCallback(
    (
      requestId: string,
      actor?: { name?: string; role?: UserRole | 'guest'; id?: string },
    ) => {
      const target = stateRef.current.classJoinRequests.find((r) => r.id === requestId);
      setClassJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      sendRealtimeMutation({
        type: 'item:remove',
        slice: 'classJoinRequests',
        id: requestId,
      });
      if (target) {
        appendSystemLog({
          category: 'class',
          level: 'info',
          action: 'Hủy yêu cầu vào lớp',
          detail: `${actor?.name ?? target.studentName} đã hủy yêu cầu tham gia lớp mã ${target.classCode}.`,
          actorName: actor?.name ?? target.studentName,
          actorRole: actor?.role ?? 'student',
          actorId: actor?.id,
          targetLabel: target.classCode,
        });
      }
    },
    [],
  );

  const reviewClassJoinRequest = useCallback(
    (
      requestId: string,
      decision: 'approved' | 'rejected',
      reviewer: { name: string; role?: UserRole; id?: string },
    ) => {
      const target = stateRef.current.classJoinRequests.find((r) => r.id === requestId);
      if (!target) return;

      const reviewedAt = new Date(getRealtimeNow()).toISOString();
      const updatedReq: ClassJoinRequest = {
        ...target,
        status: decision,
        reviewedAt,
        reviewedByTeacherName: reviewer.name,
      };
      setClassJoinRequests((prev) =>
        prev.map((r) => (r.id === requestId ? updatedReq : r)),
      );
      sendRealtimeMutation({
        type: 'item:upsert',
        slice: 'classJoinRequests',
        item: updatedReq,
      });

      if (target.studentUserId !== 'guest_student') {
        const stuAcc = listAccountsSync().find((a) => a.id === target.studentUserId);
        if (stuAcc) {
          const currentIds = new Set(stuAcc.enrolledClassIds ?? []);
          if (decision === 'approved') currentIds.add(target.classId);
          else currentIds.delete(target.classId);
          updateStoredAccount(stuAcc.id, {
            enrolledClassIds: Array.from(currentIds),
          });
        }
      }

      appendSystemLog({
        category: 'class',
        level: decision === 'approved' ? 'info' : 'warning',
        action:
          decision === 'approved'
            ? 'Giáo viên duyệt học sinh vào lớp'
            : 'Giáo viên từ chối yêu cầu vào lớp',
        detail: `${reviewer.name} đã ${
          decision === 'approved' ? 'duyệt' : 'từ chối'
        } ${target.studentName} vào lớp mã ${target.classCode}.`,
        actorName: reviewer.name,
        actorRole: reviewer.role ?? 'teacher',
        actorId: reviewer.id,
        targetLabel: target.classCode,
      });
    },
    [],
  );

  const removeClassMembership = useCallback(
    (
      classId: string,
      studentUserId: string,
      actor?: {
        name?: string;
        role?: UserRole | 'guest';
        id?: string;
        reason?: 'student_left' | 'teacher_removed';
      },
    ) => {
      const currentRequests = stateRef.current.classJoinRequests;
      const targetReq = currentRequests.find(
        (r) => r.classId === classId && r.studentUserId === studentUserId,
      );
      const nextRequests = currentRequests.filter(
        (r) => !(r.classId === classId && r.studentUserId === studentUserId),
      );
      setClassJoinRequests(nextRequests);
      sendRealtimeMutation({
        type: 'slice:set',
        slice: 'classJoinRequests',
        value: nextRequests,
      });

      if (studentUserId !== 'guest_student') {
        const stuAcc = listAccountsSync().find((a) => a.id === studentUserId);
        if (stuAcc) {
          const nextIds = (stuAcc.enrolledClassIds ?? []).filter((id) => id !== classId);
          updateStoredAccount(stuAcc.id, { enrolledClassIds: nextIds });
        }
      }

      appendSystemLog({
        category: 'class',
        level: 'warning',
        action:
          actor?.reason === 'teacher_removed'
            ? 'Giáo viên mời học sinh rời lớp'
            : 'Học sinh rời lớp học',
        detail:
          actor?.reason === 'teacher_removed'
            ? `${actor?.name ?? 'Giáo viên'} đã xóa ${
                targetReq?.studentName ?? studentUserId
              } khỏi lớp ${targetReq?.classCode ?? classId}.`
            : `${actor?.name ?? targetReq?.studentName ?? 'Học sinh'} đã rời lớp ${
                targetReq?.classCode ?? classId
              }.`,
        actorName: actor?.name ?? targetReq?.studentName ?? 'Người dùng',
        actorRole: actor?.role ?? 'student',
        actorId: actor?.id,
        targetLabel: targetReq?.classCode ?? classId,
      });
    },
    [],
  );

  const addClassMaterial = useCallback((material: ClassMaterial) => {
    setClassMaterials((prev) => [material, ...prev]);
    sendRealtimeMutation({
      type: 'item:upsert',
      slice: 'classMaterials',
      item: material,
      prepend: true,
    });
    appendSystemLog({
      category: 'class',
      level: 'info',
      action: 'Gửi tài liệu lớp học',
      detail: `Đăng tài liệu "${material.title}" vào lớp ${material.classId}.`,
      targetLabel: material.title,
    });
  }, []);

  const updateClassMaterial = useCallback((updated: ClassMaterial) => {
    setClassMaterials((prev) =>
      prev.map((m) => (m.id === updated.id ? updated : m)),
    );
    sendRealtimeMutation({
      type: 'item:upsert',
      slice: 'classMaterials',
      item: updated,
    });
    appendSystemLog({
      category: 'class',
      level: 'info',
      action: 'Cập nhật tài liệu lớp học',
      detail: `Cập nhật chia sẻ hoặc nội dung tài liệu "${updated.title}".`,
      targetLabel: updated.title,
    });
  }, []);

  const deleteClassMaterial = useCallback((id: string) => {
    setClassMaterials((prev) => prev.filter((m) => m.id !== id));
    sendRealtimeMutation({
      type: 'item:remove',
      slice: 'classMaterials',
      id,
    });
    appendSystemLog({
      category: 'class',
      level: 'warning',
      action: 'Xóa tài liệu lớp học',
      detail: `Đã gỡ tài liệu ${id}.`,
      targetLabel: id,
    });
  }, []);

  const addClassAssignment = useCallback((assignment: ClassAssignment) => {
    setClassAssignments((prev) => [assignment, ...prev]);
    sendRealtimeMutation({
      type: 'item:upsert',
      slice: 'classAssignments',
      item: assignment,
      prepend: true,
    });
    appendSystemLog({
      category: 'class',
      level: 'info',
      action: 'Giao bài tập mới',
      detail: `Giao bài tập "${assignment.title}" (Hạn ${assignment.dueDateLabel}) vào lớp ${assignment.classId}.`,
      targetLabel: assignment.title,
    });
  }, []);

  const updateClassAssignment = useCallback((updated: ClassAssignment) => {
    setClassAssignments((prev) =>
      prev.map((a) => (a.id === updated.id ? updated : a)),
    );
    sendRealtimeMutation({
      type: 'item:upsert',
      slice: 'classAssignments',
      item: updated,
    });
    appendSystemLog({
      category: 'class',
      level: 'info',
      action: 'Cập nhật bài tập lớp học',
      detail: `Cập nhật chia sẻ hoặc nội dung bài tập "${updated.title}".`,
      targetLabel: updated.title,
    });
  }, []);

  const deleteClassAssignment = useCallback((id: string) => {
    setClassAssignments((prev) => prev.filter((a) => a.id !== id));
    sendRealtimeMutation({
      type: 'item:remove',
      slice: 'classAssignments',
      id,
    });
    appendSystemLog({
      category: 'class',
      level: 'warning',
      action: 'Xóa bài tập lớp học',
      detail: `Đã gỡ bài tập ${id}.`,
      targetLabel: id,
    });
  }, []);

  const addClassScheduleSlot = useCallback((slot: ClassScheduleSlot) => {
    setClassSchedules((prev) => [...prev, slot]);
    sendRealtimeMutation({
      type: 'item:upsert',
      slice: 'classSchedules',
      item: slot,
      prepend: false,
    });
    appendSystemLog({
      category: 'class',
      level: 'info',
      action: 'Thêm lịch học mới',
      detail: `Thêm lịch "${slot.topic}" (${slot.dayKey.toUpperCase()} · ${slot.timeSlot}) cho lớp ${slot.classId}.`,
      targetLabel: `${slot.dayKey.toUpperCase()} ${slot.timeSlot}`,
    });
  }, []);

  const updateClassScheduleSlot = useCallback((updated: ClassScheduleSlot) => {
    setClassSchedules((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s)),
    );
    sendRealtimeMutation({
      type: 'item:upsert',
      slice: 'classSchedules',
      item: updated,
    });
    appendSystemLog({
      category: 'class',
      level: 'info',
      action: 'Cập nhật lịch học',
      detail: `Sửa lịch "${updated.topic}" (${updated.dayKey.toUpperCase()} · ${updated.timeSlot}).`,
      targetLabel: `${updated.dayKey.toUpperCase()} ${updated.timeSlot}`,
    });
  }, []);

  const deleteClassScheduleSlot = useCallback((id: string) => {
    setClassSchedules((prev) => prev.filter((s) => s.id !== id));
    sendRealtimeMutation({
      type: 'item:remove',
      slice: 'classSchedules',
      id,
    });
    appendSystemLog({
      category: 'class',
      level: 'warning',
      action: 'Xóa lịch học',
      detail: `Đã xóa buổi học ${id} khỏi thời khóa biểu.`,
      targetLabel: id,
    });
  }, []);

  const updateSystemConfig = useCallback((patch: Partial<SystemConfig>) => {
    const nextConfig: SystemConfig = {
      ...stateRef.current.systemConfig,
      ...patch,
    };
    setSystemConfig(nextConfig);
    sendRealtimeMutation({
      type: 'slice:set',
      slice: 'systemConfig',
      value: nextConfig,
    });
    const changedKeys = Object.keys(patch).join(', ');
    appendSystemLog({
      category: 'system',
      level: 'info',
      action: 'Cập nhật cấu hình hệ thống',
      detail: `Thay đổi thiết lập hệ thống: ${changedKeys}.`,
      targetLabel: changedKeys,
    });
  }, []);

  const resetAllDemoData = useCallback(() => {
    const normalizedSeedExams = SEED_EXAMS.map(normalizeExam);
    setQuestions(SEED_QUESTIONS);
    setExams(normalizedSeedExams);
    setSubmissions(SEED_SUBMISSIONS);
    setPrivateClasses(SEED_TEACHER_CLASSES);
    setClassJoinRequests(SEED_CLASS_JOIN_REQUESTS);
    setClassMaterials(SEED_CLASS_MATERIALS);
    setClassAssignments(SEED_CLASS_ASSIGNMENTS);
    setClassSchedules(SEED_CLASS_SCHEDULES);
    setSystemConfig(DEFAULT_SYSTEM_CONFIG);

    void (async () => {
      const seededAccounts = await buildSeedRawAccountsForServer();
      await resetSeedAccounts({ skipRemote: true });
      clearCustomSubjects({ skipRemote: true });
      resetSeedTeacherAlerts({ skipRemote: true });
      resetSeedSystemLogs({ skipRemote: true });
      sendRealtimeMutation({
        type: 'reset:all',
        data: {
          questions: SEED_QUESTIONS,
          exams: normalizedSeedExams,
          submissions: SEED_SUBMISSIONS,
          privateClasses: SEED_TEACHER_CLASSES,
          classJoinRequests: SEED_CLASS_JOIN_REQUESTS,
          classMaterials: SEED_CLASS_MATERIALS,
          classAssignments: SEED_CLASS_ASSIGNMENTS,
          classSchedules: SEED_CLASS_SCHEDULES,
          systemConfig: DEFAULT_SYSTEM_CONFIG,
          accounts: seededAccounts,
          customSubjects: [],
          teacherAlerts: SEED_TEACHER_ALERTS,
          systemLogs: SEED_SYSTEM_LOGS,
        },
      });
      appendSystemLog({
        category: 'system',
        level: 'warning',
        action: 'Khôi phục dữ liệu mẫu toàn hệ thống',
        detail: 'Đưa câu hỏi, đề thi, bài nộp, lớp học, yêu cầu vào lớp, tài liệu, lịch học và cấu hình về trạng thái gốc.',
        targetLabel: 'Full System Reset',
      });
    })();
  }, []);

  return {
    questions,
    questionMap,
    exams,
    submissions,
    privateClasses,
    classJoinRequests,
    classMaterials,
    classAssignments,
    classSchedules,
    role,
    setRole,
    systemConfig,
    updateSystemConfig,
    addQuestion,
    updateQuestion,
    deleteQuestion,
    deleteAllQuestions,
    importQuestions,
    addExam,
    updateExam,
    deleteExam,
    deleteAllExams,
    addSubmission,
    deleteSubmission,
    addPrivateClass,
    updatePrivateClass,
    deletePrivateClass,
    requestJoinClass,
    cancelJoinRequest,
    reviewClassJoinRequest,
    removeClassMembership,
    addClassMaterial,
    updateClassMaterial,
    deleteClassMaterial,
    addClassAssignment,
    updateClassAssignment,
    deleteClassAssignment,
    addClassScheduleSlot,
    updateClassScheduleSlot,
    deleteClassScheduleSlot,
    resetAllDemoData,
  };
}
