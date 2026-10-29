/**
 * Sinal em processo para acordar o worker embutido assim que um evento entra na fila.
 * Permite ao worker dormir longos períodos quando ocioso (deixando o Neon suspender a compute)
 * sem atrasar o envio de eventos novos.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function onWake(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function wakeDispatcher(): void {
  for (const fn of listeners) fn();
}
