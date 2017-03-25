import {
  DocumentNode,
  SelectionSetNode,
  FieldNode,
  FragmentDefinitionNode,
  InlineFragmentNode,
} from 'graphql';

import {
  getMainDefinition,
  getFragmentDefinitions,
  createFragmentMap,
  FragmentMap,
} from './getFromAST';

import {
  shouldInclude,
} from './directives';

import {
  isField,
  isInlineFragment,
  resultKeyNameFromField,
  argumentsObjectFromField,
} from './storeUtils';

export type Resolver = (
  fieldName: string,
  rootValue: any,
  args: any,
  context: any,
  info: ExecInfo,
) => any;

export type VariableMap = { [name: string]: any };

export type ResultMapper = (values: {[fieldName: string]: any}, rootValue: any) => any;
export type FragmentMatcher = (rootValue: any, typeCondition: string, context: any) => boolean|Promise<boolean>;

export type ExecContext = {
  fragmentMap: FragmentMap;
  contextValue: any;
  variableValues: VariableMap;
  resultMapper: ResultMapper;
  resolver: Resolver;
  fragmentMatcher: FragmentMatcher;
};


export type ExecInfo = {
  isLeaf: boolean;
  resultKey: string;
};

export type ExecOptions = {
  resultMapper?: ResultMapper;
  fragmentMatcher?: FragmentMatcher;
};

// Based on graphql function from graphql-js:
// graphql(
//   schema: GraphQLSchema,
//   requestString: string,
//   rootValue?: ?any,
//   contextValue?: ?any,
//   variableValues?: ?{[key: string]: any},
//   operationName?: ?string
// ): Promise<GraphQLResult>
export function graphql(
  resolver: Resolver,
  document: DocumentNode,
  rootValue?: any,
  contextValue?: any,
  variableValues?: VariableMap,
  execOptions: ExecOptions = {},
) {
  const mainDefinition = getMainDefinition(document);

  const fragments = getFragmentDefinitions(document);
  const fragmentMap = createFragmentMap(fragments);

  const resultMapper = execOptions.resultMapper;

  // Default matcher always matches all fragments
  const fragmentMatcher = execOptions.fragmentMatcher || (() => true);

  const execContext: ExecContext = {
    fragmentMap,
    contextValue,
    variableValues,
    resultMapper,
    resolver,
    fragmentMatcher,
  };

  return executeSelectionSet(
    mainDefinition.selectionSet,
    rootValue,
    execContext,
  );
}


function executeSelectionSet(
  selectionSet: SelectionSetNode,
  rootValue: any,
  execContext: ExecContext,
) {
  const {
    fragmentMap,
    contextValue,
    variableValues: variables,
  } = execContext;

  const result = {};

  return promiseOrImmediate(arrayOrPromise(selectionSet.selections.map((selection) => {
    if (!shouldInclude(selection, variables)) {
      // Skip this entirely
      return;
    }

    if (isField(selection)) {
      const fieldResultOrPromise = executeField(
        selection,
        rootValue,
        execContext,
      );

      return promiseOrImmediate(fieldResultOrPromise, (fieldResult) => {
        const resultFieldKey = resultKeyNameFromField(selection);

        if (fieldResult !== undefined) {
          result[resultFieldKey] = fieldResult;
        }
      });
    } else {
      let fragment: InlineFragmentNode | FragmentDefinitionNode;

      if (isInlineFragment(selection)) {
        fragment = selection;
      } else {
        // This is a named fragment
        fragment = fragmentMap[selection.name.value];

        if (!fragment) {
          throw new Error(`No fragment named ${selection.name.value}`);
        }
      }

      const typeCondition = fragment.typeCondition.name.value;

      return promiseOrImmediate(execContext.fragmentMatcher(rootValue, typeCondition, contextValue), (fragmentMatcherResult) => {

        if (fragmentMatcherResult) {
          const fragmentResultOrPromise = executeSelectionSet(
            fragment.selectionSet,
            rootValue,
            execContext,
          );

          return promiseOrImmediate(fragmentResultOrPromise, (fragmentResult) => {
            merge(result, fragmentResult);
          });

        }

      });
    }
  })), () => {
    if (execContext.resultMapper) {
      return execContext.resultMapper(result, rootValue);
    }

    return result;
  });
}

function executeField(
  field: FieldNode,
  rootValue: any,
  execContext: ExecContext,
): any {
  const {
    variableValues: variables,
    contextValue,
    resolver,
  } = execContext;

  const fieldName = field.name.value;
  const args = argumentsObjectFromField(field, variables);

  const info: ExecInfo = {
    isLeaf: !field.selectionSet,
    resultKey: resultKeyNameFromField(field),
  };

  const resultOrPromise = resolver(fieldName, rootValue, args, contextValue, info);

  return promiseOrImmediate(resultOrPromise, (result) => {
    // Handle all scalar types here
    if (!field.selectionSet) {
      return result;
    }

    // From here down, the field has a selection set, which means it's trying to
    // query a GraphQLObjectType
    if (result == null) {
      // Basically any field in a GraphQL response can be null, or missing
      return result;
    }

    if (Array.isArray(result)) {
      return executeSubSelectedArray(field, result, execContext);
    }

    // Returned value is an object, and the query has a sub-selection. Recurse.
    return executeSelectionSet(
      field.selectionSet,
      result,
      execContext,
    );
  });
}

function executeSubSelectedArray(
  field,
  result,
  execContext,
) {
  return arrayOrPromise(result.map((item) => {
    // null value in array
    if (item === null) {
      return null;
    }

    // This is a nested array, recurse
    if (Array.isArray(item)) {
      return executeSubSelectedArray(field, item, execContext);
    }

    // This is an object, run the selection set on it
    return executeSelectionSet(
      field.selectionSet,
      item,
      execContext,
    );
  }));
}

function merge(dest, src) {
  if (
    src === null ||
    typeof src !== 'object'
  ) {
    // These types just override whatever was in dest
    return src;
  }

  // Merge sub-objects
  Object.keys(dest).forEach((destKey) => {
    if (src.hasOwnProperty(destKey)) {
      merge(dest[destKey], src[destKey]);
    }
  });

  // Add props only on src
  Object.keys(src).forEach((srcKey) => {
    if (!dest.hasOwnProperty(srcKey)) {
      dest[srcKey] = src[srcKey];
    }
  });
}

function isPromise(obj) {
  return obj && typeof obj === 'object' && typeof obj.then === 'function';
}

function promiseOrImmediate(obj, fn) {
  if (isPromise(obj)) {
    return obj.then(fn);
  } else {
    return fn(obj);
  }
}

function arrayOrPromise(arr) {
  if (arr.some(isPromise)) {
    return Promise.all(arr);
  } else {
    return arr;
  }
}
