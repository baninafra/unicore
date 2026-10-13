-- UniCore · esquema para cuando migremos de la base local (IndexedDB) a Supabase.
-- Espeja src/lib/types.ts. Todavía no se usa.

CREATE TABLE degrees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  institution TEXT,
  color TEXT NOT NULL DEFAULT 'primary', -- 'primary' (blurple) | 'cyan'
  total_years NUMERIC(3,1) DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  degree_id TEXT REFERENCES degrees(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  year INTEGER NOT NULL DEFAULT 1,
  semester INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'PENDIENTE', -- PENDIENTE | CURSANDO | REGULAR | APROBADA
  final_grade NUMERIC(4,2),
  correlatives TEXT[] DEFAULT '{}',
  professor_email TEXT,
  campus_url TEXT,
  drive_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  degree_id TEXT REFERENCES degrees(id) ON DELETE CASCADE,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  ai_summary TEXT,
  type TEXT NOT NULL DEFAULT 'TAREA', -- PARCIAL | FINAL | TP | FORO | LECTURA | TAREA
  status TEXT NOT NULL DEFAULT 'TODO', -- INBOX_EMAIL | TODO | IN_PROGRESS | DONE
  priority TEXT DEFAULT 'MEDIUM',
  due_date TIMESTAMPTZ,
  source TEXT DEFAULT 'MANUAL', -- MANUAL | EMAIL_AUTO
  raw_email_body TEXT,
  raw_email_from TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  unit_number INTEGER DEFAULT 1,
  content JSONB NOT NULL DEFAULT '[]'::jsonb,
  plain_text_cache TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fotos y PDFs originales van a Supabase Storage (bucket "files"); acá sólo la referencia.
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  size INTEGER,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE subject_documents (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE NOT NULL,
  unit_number INTEGER DEFAULT 1,
  file_name TEXT NOT NULL,
  extracted_text TEXT NOT NULL,
  page_count INTEGER,
  file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE flashcards (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE NOT NULL,
  note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  due TIMESTAMPTZ DEFAULT NOW(),
  stability NUMERIC DEFAULT 0,
  difficulty NUMERIC DEFAULT 0,
  elapsed_days INTEGER DEFAULT 0,
  scheduled_days INTEGER DEFAULT 0,
  learning_steps INTEGER DEFAULT 0,
  reps INTEGER DEFAULT 0,
  lapses INTEGER DEFAULT 0,
  state INTEGER DEFAULT 0,
  last_review TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE study_sessions (
  id TEXT PRIMARY KEY,
  subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
  duration_minutes INTEGER NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT NOW()
);
