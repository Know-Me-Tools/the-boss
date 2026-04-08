ALTER TABLE `agents` ADD `knowledge_bases` text;
ALTER TABLE `agents` ADD `knowledgeRecognition` text;
ALTER TABLE `agents` ADD `knowledge_base_configs` text;

ALTER TABLE `sessions` ADD `knowledge_bases` text;
ALTER TABLE `sessions` ADD `knowledgeRecognition` text;
ALTER TABLE `sessions` ADD `knowledge_base_configs` text;
