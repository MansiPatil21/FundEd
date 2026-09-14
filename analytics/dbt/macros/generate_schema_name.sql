{#
  dbt's default prefixes custom schemas with the target schema (analytics_staging). Using the
  custom name as-is gives the warehouse the plain raw, staging and marts layers analysts expect.
#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}
