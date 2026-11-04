import { Suspense } from 'react'
import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'

async function Todos() {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)

  const { data: todos, error } = await supabase.from('todos').select()

  // PGRST205 = table missing: the key and URL work, the schema just isn't created yet.
  const status = !error
    ? 'connected'
    : error.code === 'PGRST205'
      ? 'connected — no tables yet'
      : `error: ${error.message}`

  return (
    <>
      <p className="text-sm text-gray-500">Supabase: {status}</p>
      <ul>
        {todos?.map((todo) => (
          <li key={todo.id}>{todo.name}</li>
        ))}
      </ul>
    </>
  )
}

export default function Page() {
  return (
    <main className="p-8">
      <Suspense fallback={<p className="text-sm text-gray-500">Supabase: connecting…</p>}>
        <Todos />
      </Suspense>
    </main>
  )
}
