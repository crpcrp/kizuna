import { statSync } from 'node:fs'
import Database from 'better-sqlite3'
import { requiredPackagedResources } from './resourcePaths'

const resourcesPath = process.argv[2]

try {
  if (!resourcesPath) throw new Error('Expected the installed resources path')

  for (const resource of requiredPackagedResources(resourcesPath)) {
    const stat = statSync(resource.path)
    const valid = resource.kind === 'file' ? stat.isFile() : stat.isDirectory()
    if (!valid) throw new Error(`${resource.label} is not a ${resource.kind}: ${resource.path}`)
  }

  const db = new Database(':memory:')
  try {
    db.prepare('SELECT 1').get()
  } finally {
    db.close()
  }

  console.log('Packaged application smoke check passed')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
