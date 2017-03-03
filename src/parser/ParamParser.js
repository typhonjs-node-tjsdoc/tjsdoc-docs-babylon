import AbstractParamParser from 'tjsdoc-docs-common/src/parser/AbstractParamParser.js';

/**
 * Param Type Parser.
 */
export default class ParamParser extends AbstractParamParser
{
   /**
    * Guess param type by using param default arguments.
    *
    * @param {Object} params - node of callable AST node.
    *
    * @example
    * // with method
    * let results = ParamParser.guessParams(node.value.params);
    *
    * // with function
    * let results = ParamParser.guessParams(node.params);
    *
    * @returns {ParsedParam[]} guess param results.
    */
   guessParams(params)
   {
      const _params = [];

      for (let i = 0; i < params.length; i++)
      {
         const param = params[i];
         const result = {};

         switch (param.type)
         {
            case 'Identifier':
               // e.g. func(a){}
               result.name = param.name;
               result.types = ['*'];
               break;

            case 'AssignmentPattern':
               if (param.left.type === 'Identifier')
               {
                  result.name = param.left.name;
               }
               else if (param.left.type === 'ObjectPattern')
               {
                  result.name = `objectPattern${i === 0 ? '' : i}`;
               }
               else if (param.left.type === 'ArrayPattern')
               {
                  result.name = `arrayPattern${i === 0 ? '' : i}`;
               }

               result.optional = true;

               if (param.right.type.includes('Literal'))
               {
                  // e.g. func(a = 10){}
                  result.types = param.right.value === null ? ['*'] : [typeof param.right.value];
                  result.defaultRaw = param.right.value;
                  result.defaultValue = `${result.defaultRaw}`;
               }
               else if (param.right.type === 'ArrayExpression')
               {
                  // e.g. func(a = [123]){}
                  result.types = param.right.elements.length ? [`${typeof param.right.elements[0].value}[]`] : ['*[]'];
                  result.defaultRaw = param.right.elements.map((elm) => elm.value);
                  result.defaultValue = `${JSON.stringify(result.defaultRaw)}`;
               }
               else if (param.right.type === 'ObjectExpression')
               {
                  const typeMap = {};

                  for (const prop of param.left.properties || [])
                  {
                     typeMap[prop.key.name] = '*';
                  }

                  // e.g. func(a = {key: 123}){}
                  const obj = {};

                  for (const prop of param.right.properties)
                  {
                     obj[prop.key.name] = prop.value.value;
                     typeMap[prop.key.name] = typeof prop.value.value;
                  }

                  const types = [];

                  for (const key of Object.keys(typeMap))
                  {
                     types.push(`"${key}": ${typeMap[key]}`);
                  }

                  result.types = [`{${types.join(', ')}}`];
                  result.defaultRaw = obj;
                  result.defaultValue = `${JSON.stringify(result.defaultRaw)}`;
               }
               else if (param.right.type === 'Identifier')
               {
                  // e.g. func(a = value){}
                  result.types = ['*'];
                  result.defaultRaw = param.right.name;
                  result.defaultValue = `${param.right.name}`;
               }
               else
               {
                  // e.g. func(a = new Foo()){}, func(a = foo()){}
                  // CallExpression, NewExpression
                  result.types = ['*'];
               }
               break;

            case 'RestElement':
               // e.g. func(...a){}
               result.name = `${param.argument.name}`;
               result.types = ['...*'];
               result.spread = true;
               break;

            case 'ObjectPattern':
            {
               const objectPattern = [];
               const raw = {};

               for (const property of param.properties)
               {
                  if (property.type === 'ObjectProperty')
                  {
                     objectPattern.push(`"${property.key.name}": *`);
                     raw[property.key.name] = null;
                  }
                  else if (property.type === 'RestProperty')
                  {
                     objectPattern.push(`...${property.argument.name}: Object`);
                     raw[property.argument.name] = {};
                  }
               }

               result.name = `objectPattern${i === 0 ? '' : i}`;
               result.types = [`{${objectPattern.join(', ')}}`];
               result.defaultRaw = raw;
               result.defaultValue = `${JSON.stringify(result.defaultRaw)}`;

               break;
            }

            case 'ArrayPattern':
            {
               // e.g. func([a, b = 10]){}
               let arrayType = null;
               const raw = [];

               for (const element of param.elements)
               {
                  if (element.type === 'Identifier')
                  {
                     raw.push('null');
                  }
                  else if (element.type === 'AssignmentPattern')
                  {
                     if ('value' in element.right)
                     {
                        if (!arrayType && element.right.value !== null) { arrayType = typeof element.right.value; }

                        raw.push(JSON.stringify(element.right.value));
                     }
                     else
                     {
                        raw.push('*');
                     }
                  }
               }

               if (!arrayType) { arrayType = '*'; }

               result.name = `arrayPattern${i === 0 ? '' : i}`;
               result.types = [`${arrayType}[]`];
               result.defaultRaw = raw;
               result.defaultValue = `[${raw.join(', ')}]`;

               break;
            }
            default:
               this._eventbus.trigger('log:warn', 'unknown param.type', param);
               break;
         }

         _params.push(result);
      }

      return _params;
   }

   /**
    * guess return type by using return node.
    *
    * @param {ASTNode} body - callable body node.
    *
    * @returns {ParsedParam|null}
    */
   guessReturnParam(body)
   {
      const result = {};

      this._eventbus.trigger('ast:walker:traverse', body,
      {
         enterNode: (node) =>
         {
            // `return` in Function is not the body's `return`
            if (node.type.includes('Function')) { return null; }

            if (node.type !== 'ReturnStatement') { return; }

            if (!node.argument) { return; }

            result.types = this.guessType(node.argument).types;
         }
      });

      if (result.types) { return result; }

      return null;
   }

   /**
    * guess self type by using assignment node.
    *
    * @param {ASTNode} right - assignment right node.
    *
    * @returns {ParsedParam}
    */
   guessType(right)
   {
      if (!right) { return { types: ['*'] }; }

      if (right.type === 'TemplateLiteral') { return { types: ['string'] }; }

      if (right.type === 'NullLiteral') { return { types: ['*'] }; }

      if (right.type.includes('Literal')) { return { types: [typeof right.value] }; }

      if (right.type === 'ArrayExpression')
      {
         if (right.elements.length)
         {
            return { types: [`${typeof right.elements[0].value}[]`] };
         }
         else
         {
            return { types: ['*[]'] };
         }
      }

      if (right.type === 'ObjectExpression')
      {
         const typeMap = {};

         for (const prop of right.properties)
         {
            switch (prop.type)
            {
               case 'ObjectProperty':
               {
                  const name = `"${prop.key.name || prop.key.value}"`;

                  typeMap[name] = prop.value.value ? typeof prop.value.value : '*';

                  break;
               }

               case 'ObjectMethod':
               {
                  const name = `"${prop.key.name || prop.key.value}"`;

                  typeMap[name] = 'function';

                  break;
               }

               case 'SpreadProperty':
               {
                  const name = `...${prop.argument.name}`;

                  typeMap[name] = 'Object';

                  break;
               }

               default:
               {
                  const name = `"${prop.key.name || prop.key.value}"`;

                  typeMap[name] = '*';

                  break;
               }
            }
         }

         const types = [];

         for (const key of Object.keys(typeMap))
         {
            types.push(`${key}: ${typeMap[key]}`);
         }

         return { types: [`{${types.join(', ')}}`] };
      }

      return { types: ['*'] };
   }
}
