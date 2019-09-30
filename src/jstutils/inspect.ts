// @ts-ignore nodeJS typescript not loaded
import * as util from 'util';

export default function inspect(smthing: unknown) {
  return util.inspect(smthing);
}
