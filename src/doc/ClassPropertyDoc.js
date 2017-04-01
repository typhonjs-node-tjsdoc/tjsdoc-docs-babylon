import AbstractClassPropertyDoc  from 'tjsdoc-docs-common/src/doc/abstract/AbstractClassPropertyDoc.js';

import MethodDoc                 from './MethodDoc.js';

/**
 * Doc Class from ClassProperty AST node.
 */
export default class ClassPropertyDoc extends AbstractClassPropertyDoc
{
   /** Borrow {@link MethodDoc#@_memberof} */
   static _$memberof()
   {
      Reflect.apply(MethodDoc._$memberof, this, []);
   }

   /** Take out self name from self node */
   static _$name()
   {
      this._value.name = this._node.key.name;
   }

   /**
    * Decide if `static`.
    */
   static _$static()
   {
      if ('static' in this._node)
      {
         this._value.static = this._node.static;
      }
   }

   /** If @type does not exist then guess type by using self node */
   static _$type()
   {
      super._$type();

      if (this._value.type) { return; }

      this._value.type = this._eventbus.triggerSync('tjsdoc:system:parser:param:type:guess', this._node.value);
   }
}
