export async function runDirectRemoteMutation({ revalidate, mutate } = {}) {
  if (typeof revalidate !== 'function' || typeof mutate !== 'function') {
    throw new Error('Direct remote mutation requires revalidate and mutate callbacks')
  }
  await revalidate()
  return await mutate()
}
